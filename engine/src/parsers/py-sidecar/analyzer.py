#!/usr/bin/env python3
"""Code MRI - Django static analyzer (sidecar).

Reads a JSON request from stdin: {"root": "<abs>", "files": ["<rel.py>", ...]}
and writes a JSON fact bundle to stdout. Pure `ast` static analysis - the target
project is never imported or executed.

The TypeScript wrapper turns these facts into graph nodes/edges and assembles
canonical API routes (include() + router resolution happens there).
"""
import ast
import json
import os
import sys


def dotted(node):
    """Return the dotted name of a Name/Attribute node, else ''."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = dotted(node.value)
        return base + "." + node.attr if base else node.attr
    return ""


def str_const(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def line_of(node):
    return getattr(node, "lineno", 1)


def base_names(cls):
    return [dotted(b) for b in cls.bases]


def is_model(cls):
    return any(b == "models.Model" or b.endswith(".Model") or b == "Model" for b in base_names(cls))


def is_manager(cls):
    return any(b.endswith("Manager") or b.endswith("QuerySet") for b in base_names(cls))


def is_serializer(cls):
    return any(b.endswith("Serializer") for b in base_names(cls))


def is_pydantic_model(cls):
    return any(b == "BaseModel" or b.endswith(".BaseModel") for b in base_names(cls))


def pydantic_fields(cls):
    """Annotated attributes of a Pydantic model: `name: type [= default]`."""
    fields = []
    for stmt in cls.body:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            fields.append(
                {
                    "name": stmt.target.id,
                    "type": dotted(stmt.annotation).split(".")[-1] or "Any",
                    "line": stmt.lineno,
                    "options": {},
                }
            )
    return fields


def is_view(cls):
    bs = base_names(cls)
    return any(
        ("viewsets" in b) or b.endswith("APIView") or ("generics" in b) or b.endswith("ViewSet")
        for b in bs
    )


def is_model_viewset(cls):
    return any("ModelViewSet" in b for b in base_names(cls))


def field_type(call):
    """For a `models.EmailField(...)` call, return 'EmailField' or '' if not a field."""
    name = dotted(call.func)
    last = name.split(".")[-1]
    if name.startswith("models.") or last.endswith("Field") or last in (
        "ForeignKey",
        "OneToOneField",
        "ManyToManyField",
    ):
        return last
    return ""


def field_options(call):
    opts = {}
    for kw in call.keywords:
        if kw.arg is None:
            continue
        v = kw.value
        if isinstance(v, ast.Constant):
            opts[kw.arg] = v.value
    return opts


def model_fields(cls):
    fields = []
    for stmt in cls.body:
        # name = models.XField(...)   or   name: Type = models.XField(...)
        target = None
        value = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(
            stmt.targets[0], ast.Name
        ):
            target = stmt.targets[0].id
            value = stmt.value
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            target = stmt.target.id
            value = stmt.value
        if target is None or not isinstance(value, ast.Call):
            continue
        ftype = field_type(value)
        if not ftype:
            continue
        fields.append(
            {"name": target, "type": ftype, "line": stmt.lineno, "options": field_options(value)}
        )
    return fields


def model_managers(cls):
    managers = []
    for stmt in cls.body:
        target = None
        value = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(
            stmt.targets[0], ast.Name
        ):
            target = stmt.targets[0].id
            value = stmt.value
        if target is None or not isinstance(value, ast.Call):
            continue
        manager = dotted(value.func).split(".")[-1]
        if manager.endswith("Manager") or manager.endswith("QuerySet"):
            managers.append({"name": target, "manager": manager, "line": stmt.lineno})
    return managers


def class_attr_value(cls, attr):
    """Return the assigned value node for `attr = ...` in a class body, or None."""
    for stmt in cls.body:
        if isinstance(stmt, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == attr for t in stmt.targets
        ):
            return stmt.value
    return None


def serializer_meta(cls):
    model = None
    fields = None
    for stmt in cls.body:
        if isinstance(stmt, ast.ClassDef) and stmt.name == "Meta":
            mv = class_attr_value(stmt, "model")
            if mv is not None:
                model = dotted(mv).split(".")[-1] or None
            fv = class_attr_value(stmt, "fields")
            if isinstance(fv, (ast.List, ast.Tuple)):
                fields = [str_const(e) for e in fv.elts if str_const(e) is not None]
            elif str_const(fv) == "__all__":
                fields = "__all__"
    return model, fields


def serializer_declared_fields(cls):
    fields = []
    for stmt in cls.body:
        target = None
        value = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(
            stmt.targets[0], ast.Name
        ):
            target = stmt.targets[0].id
            value = stmt.value
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            target = stmt.target.id
            value = stmt.value
        if target is None or not isinstance(value, ast.Call):
            continue
        call_name = dotted(value.func).split(".")[-1]
        source = kw_str(value, "source")
        fields.append(
            {
                "name": target,
                "source": source,
                "kind": "method" if call_name == "SerializerMethodField" else "field",
            }
        )
    return fields


def serializer_nested_fields(cls):
    nested = []
    for stmt in cls.body:
        target = None
        value = None
        if isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(
            stmt.targets[0], ast.Name
        ):
            target = stmt.targets[0].id
            value = stmt.value
        elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            target = stmt.target.id
            value = stmt.value
        if target is None or not isinstance(value, ast.Call):
            continue
        serializer = dotted(value.func).split(".")[-1]
        if serializer.endswith("Serializer"):
            nested.append({"field": target, "serializer": serializer})
    return nested


def view_info(cls):
    sc = class_attr_value(cls, "serializer_class")
    serializer_class = dotted(sc).split(".")[-1] if sc is not None else None
    qs = class_attr_value(cls, "queryset")
    queryset_model = None
    if isinstance(qs, ast.Call):
        # User.objects.all() -> root Name is the model
        node = qs.func
        while isinstance(node, ast.Attribute):
            node = node.value
        if isinstance(node, ast.Name):
            queryset_model = node.id
    elif isinstance(qs, ast.Attribute):
        node = qs
        while isinstance(node, ast.Attribute):
            node = node.value
        if isinstance(node, ast.Name):
            queryset_model = node.id
    return serializer_class, queryset_model


def decorator_names(fn):
    names = []
    for d in fn.decorator_list:
        if isinstance(d, ast.Call):
            names.append(dotted(d.func))
        else:
            names.append(dotted(d))
    return names


def is_celery_task(fn):
    for n in decorator_names(fn):
        last = n.split(".")[-1]
        if last in ("shared_task", "task"):
            return True
    return False


QUERYSET_METHODS = {
    "all",
    "bulk_create",
    "count",
    "create",
    "delete",
    "exclude",
    "exists",
    "filter",
    "first",
    "get",
    "get_or_create",
    "last",
    "order_by",
    "select_related",
    "prefetch_related",
    "update",
    "update_or_create",
}


def queryset_model_from_call(call):
    if not isinstance(call.func, ast.Attribute) or call.func.attr not in QUERYSET_METHODS:
        return None
    value = call.func.value
    if (
        isinstance(value, ast.Attribute)
        and value.attr == "objects"
        and isinstance(value.value, ast.Name)
    ):
        return value.value.id
    return None


def queryset_uses(node, rel, owner, owner_kind):
    uses = []
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        model = queryset_model_from_call(child)
        if model:
            uses.append(
                {
                    "file": rel,
                    "owner": owner,
                    "owner_kind": owner_kind,
                    "model": model,
                    "method": child.func.attr,
                    "line": child.lineno,
                }
            )
    return uses


def signal_receiver(fn):
    receivers = []
    for dec in fn.decorator_list:
        if not isinstance(dec, ast.Call):
            continue
        if dotted(dec.func).split(".")[-1] != "receiver":
            continue
        signal = dotted(dec.args[0]).split(".")[-1] if dec.args else None
        sender = None
        for kw in dec.keywords:
            if kw.arg == "sender":
                sender = dotted(kw.value).split(".")[-1] or None
        if signal:
            receivers.append({"signal": signal, "sender": sender})
    return receivers


HTTP_VERBS = {"get", "post", "put", "patch", "delete", "options", "head"}


def kw_str(call, name):
    """String value of keyword `name=...` on a Call, or None."""
    for kw in call.keywords:
        if kw.arg == name:
            return str_const(kw.value)
    return None


def kw_dotted(call, name):
    """Dotted keyword value for `name=User`, `name=schemas.User`, or `list[User]`."""
    for kw in call.keywords:
        if kw.arg != name:
            continue
        value = kw.value
        if isinstance(value, ast.Subscript):
            value = value.slice
        parsed = dotted(value).split(".")[-1]
        return parsed or None
    return None


def http_router_kind(call):
    """(framework, kind, prefix) for FastAPI/Flask constructors, else None."""
    name = dotted(call.func).split(".")[-1]
    if name == "FastAPI":
        return ("fastapi", "app", "")
    if name == "APIRouter":
        return ("fastapi", "router", kw_str(call, "prefix") or "")
    if name == "Flask":
        return ("flask", "app", "")
    if name == "Blueprint":
        return ("flask", "router", kw_str(call, "url_prefix") or "")
    return None


def attr_root_name(node):
    """Variable name for `x` / `x.y` decorator targets: 'x' / last segment."""
    if isinstance(node, ast.Name):
        return node.id
    return dotted(node).split(".")[-1]


def import_facts(rel, tree):
    imports = []
    aliases = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                local = alias.asname or alias.name.split(".")[0]
                aliases[local] = {"module": alias.name, "name": None}
                imports.append(
                    {
                        "file": rel,
                        "module": alias.name,
                        "name": None,
                        "alias": local,
                        "line": node.lineno,
                    }
                )
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                if alias.name == "*":
                    continue
                local = alias.asname or alias.name
                aliases[local] = {"module": node.module, "name": alias.name}
                imports.append(
                    {
                        "file": rel,
                        "module": node.module,
                        "name": alias.name,
                        "alias": local,
                        "line": node.lineno,
                    }
                )
    return imports, aliases


def function_name(owner, name):
    return f"{owner}.{name}" if owner else name


def function_call_target(call, imports, owner):
    func = call.func
    if isinstance(func, ast.Name):
        imported = imports.get(func.id)
        if imported and imported["name"]:
            return {
                "target": imported["name"],
                "target_module": imported["module"],
                "line": call.lineno,
            }
        return {"target": func.id, "target_module": None, "line": call.lineno}

    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name):
            base = func.value.id
            if base == "self" and owner:
                return {
                    "target": function_name(owner, func.attr),
                    "target_module": None,
                    "line": call.lineno,
                }
            imported = imports.get(base)
            if imported and imported["name"] is None:
                return {
                    "target": func.attr,
                    "target_module": imported["module"],
                    "line": call.lineno,
                }
    return None


def collect_function_calls(node, rel, caller, imports, owner=None):
    calls = []
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        target = function_call_target(child, imports, owner)
        if not target:
            continue
        calls.append(
            {
                "file": rel,
                "caller": caller,
                "target": target["target"],
                "target_module": target["target_module"],
                "line": target["line"],
            }
        )
    return calls


def extract_http(rel, tree, out):
    """FastAPI/Flask: routers (with own prefix), decorator routes, and mounts."""
    local_routers = set()
    for node in tree.body:
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Call)
        ):
            info = http_router_kind(node.value)
            if info:
                framework, kind, prefix = info
                name = node.targets[0].id
                local_routers.add(name)
                out["http_routers"].append(
                    {"file": rel, "name": name, "framework": framework, "kind": kind, "prefix": prefix}
                )

    if not local_routers:
        return

    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call) or not isinstance(dec.func, ast.Attribute):
                continue
            router_name = attr_root_name(dec.func.value)
            if router_name not in local_routers:
                continue
            attr = dec.func.attr
            path = str_const(dec.args[0]) if dec.args else "/"
            path = path or "/"
            if attr in HTTP_VERBS:
                out["http_routes"].append(
                    {
                        "file": rel,
                        "router": router_name,
                        "method": attr.upper(),
                        "path": path,
                        "handler": node.name,
                        "line": node.lineno,
                        "response_model": kw_dotted(dec, "response_model"),
                    }
                )
            elif attr == "route":
                methods = ["GET"]
                for kw in dec.keywords:
                    if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                        found = [str_const(e) for e in kw.value.elts if str_const(e) is not None]
                        if found:
                            methods = [m.upper() for m in found]
                for m in methods:
                    out["http_routes"].append(
                        {
                            "file": rel,
                            "router": router_name,
                            "method": m,
                            "path": path,
                            "handler": node.name,
                            "line": node.lineno,
                            "response_model": kw_dotted(dec, "response_model"),
                        }
                    )

    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr in ("include_router", "register_blueprint")
            and node.args
        ):
            parent = attr_root_name(node.func.value)
            child = dotted(node.args[0]).split(".")[-1]
            prefix = kw_str(node, "prefix") or kw_str(node, "url_prefix") or ""
            if parent and child:
                out["http_mounts"].append(
                    {"file": rel, "parent": parent, "child": child, "prefix": prefix}
                )


def analyze_file(rel, source, out):
    try:
        tree = ast.parse(source, filename=rel)
    except SyntaxError:
        return

    imports, import_aliases = import_facts(rel, tree)
    out["imports"].extend(imports)

    for node in tree.body:
        if isinstance(node, ast.ClassDef):
            owner_kind = "view" if is_view(node) else "manager" if is_manager(node) else "class"
            for stmt in node.body:
                if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    name = function_name(node.name, stmt.name)
                    out["functions"].append(
                        {
                            "file": rel,
                            "name": name,
                            "line": stmt.lineno,
                            "owner": node.name,
                            "owner_kind": owner_kind,
                        }
                    )
                    out["function_calls"].extend(
                        collect_function_calls(stmt, rel, name, import_aliases, node.name)
                    )
            if is_model(node) or is_pydantic_model(node):
                fields = pydantic_fields(node) if is_pydantic_model(node) else model_fields(node)
                out["models"].append(
                    {
                        "file": rel,
                        "name": node.name,
                        "line": node.lineno,
                        "fields": fields,
                        "managers": [] if is_pydantic_model(node) else model_managers(node),
                    }
                )
            elif is_manager(node):
                out["managers"].append({"file": rel, "name": node.name, "line": node.lineno})
                out["queryset_uses"].extend(queryset_uses(node, rel, node.name, "manager"))
            elif is_serializer(node):
                model, fields = serializer_meta(node)
                nested = serializer_nested_fields(node)
                declared_fields = serializer_declared_fields(node)
                out["serializers"].append(
                    {
                        "file": rel,
                        "name": node.name,
                        "line": node.lineno,
                        "model": model,
                        "fields": fields,
                        "declared_fields": declared_fields,
                        "nested": nested,
                    }
                )
            elif is_view(node):
                sc, qm = view_info(node)
                out["views"].append(
                    {
                        "file": rel,
                        "name": node.name,
                        "line": node.lineno,
                        "is_model_viewset": is_model_viewset(node),
                        "serializer_class": sc,
                        "queryset_model": qm,
                    }
                )
                out["queryset_uses"].extend(queryset_uses(node, rel, node.name, "view"))
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            out["functions"].append(
                {
                    "file": rel,
                    "name": node.name,
                    "line": node.lineno,
                    "owner": None,
                    "owner_kind": "module",
                }
            )
            out["function_calls"].extend(
                collect_function_calls(node, rel, node.name, import_aliases, None)
            )
            if is_celery_task(node):
                out["celery_tasks"].append({"file": rel, "name": node.name, "line": node.lineno})
            for receiver in signal_receiver(node):
                out["signals"].append(
                    {
                        "file": rel,
                        "name": node.name,
                        "line": node.lineno,
                        "signal": receiver["signal"],
                        "sender": receiver["sender"],
                    }
                )
            out["queryset_uses"].extend(queryset_uses(node, rel, node.name, "function"))

    # Module-level statements: settings, includes, router registrations.
    for node in ast.walk(tree):
        # ROOT_URLCONF = "config.urls"
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "ROOT_URLCONF":
                    s = str_const(node.value)
                    if s:
                        out["root_urlconf"] = s
        # router.register("users", UserViewSet, basename="user")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "register":
            if node.args:
                prefix = str_const(node.args[0])
                viewset = dotted(node.args[1]).split(".")[-1] if len(node.args) > 1 else None
                router = attr_root_name(node.func.value)
                basename = None
                for kw in node.keywords:
                    if kw.arg == "basename":
                        basename = str_const(kw.value)
                if prefix is not None and viewset:
                    out["registrations"].append(
                        {
                            "file": rel,
                            "prefix": prefix,
                            "viewset": viewset,
                            "basename": basename,
                            "router": router,
                        }
                    )
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "connect" and node.args:
            signal = dotted(node.func.value).split(".")[-1]
            receiver = dotted(node.args[0]).split(".")[-1]
            sender = None
            for kw in node.keywords:
                if kw.arg == "sender":
                    sender = dotted(kw.value).split(".")[-1] or None
            if signal and receiver:
                out["signals"].append(
                    {
                        "file": rel,
                        "name": receiver,
                        "line": node.lineno,
                        "signal": signal,
                        "sender": sender,
                    }
                )
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Call):
            router_kind = dotted(node.value.func).split(".")[-1]
            if router_kind in ("NestedSimpleRouter", "NestedDefaultRouter") and len(node.value.args) >= 2:
                parent = dotted(node.value.args[0]).split(".")[-1]
                parent_prefix = str_const(node.value.args[1])
                lookup = kw_str(node.value, "lookup") or "parent"
                if parent and parent_prefix:
                    out["nested_routers"].append(
                        {
                            "file": rel,
                            "name": node.targets[0].id,
                            "parent": parent,
                            "parent_prefix": parent_prefix,
                            "lookup": lookup,
                        }
                    )
        # path("api/", include("users.urls"))
        if isinstance(node, ast.Call) and dotted(node.func).split(".")[-1] in ("path", "re_path") and len(node.args) >= 2:
            prefix = str_const(node.args[0])
            inc = node.args[1]
            if isinstance(inc, ast.Call) and dotted(inc.func).split(".")[-1] == "include" and inc.args:
                module = str_const(inc.args[0])
                if prefix is not None and module:
                    out["includes"].append({"file": rel, "prefix": prefix, "module": module})

    extract_http(rel, tree, out)


def main():
    req = json.load(sys.stdin)
    root = req["root"]
    files = req["files"]
    out = {
        "base_dir": "",
        "root_urlconf": None,
        "models": [],
        "managers": [],
        "signals": [],
        "queryset_uses": [],
        "functions": [],
        "function_calls": [],
        "imports": [],
        "serializers": [],
        "views": [],
        "registrations": [],
        "includes": [],
        "celery_tasks": [],
        "nested_routers": [],
        "http_routers": [],
        "http_routes": [],
        "http_mounts": [],
    }
    for rel in files:
        if os.path.basename(rel) == "manage.py":
            out["base_dir"] = os.path.dirname(rel)
        try:
            with open(os.path.join(root, rel), "r", encoding="utf-8") as fh:
                source = fh.read()
        except OSError:
            continue
        analyze_file(rel, source, out)
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
