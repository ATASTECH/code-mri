import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, test } from "vitest";
import { nodeId } from "../../ids.js";
import { scanRepo } from "../../scanner/scan.js";
import { analyzePython } from "./analyze.js";
import { runSidecar } from "./sidecar.js";

const FIXTURE = fileURLToPath(
  new URL("../../../test/fixtures/sample-app", import.meta.url),
);

async function analyzeFixture() {
  const scan = await scanRepo(FIXTURE);
  const py = scan.files.filter((f) => f.category === "python").map((f) => f.path);
  return analyzePython(scan.root, py);
}

describe("analyzePython (golden fixture, spawns python sidecar)", () => {
  test("produces the User model and the canonical /api/users/ route", async () => {
    const a = await analyzeFixture();
    expect(a.nodes.some((n) => n.id === nodeId("Model", "backend/users/models.py", "User"))).toBe(
      true,
    );
    expect(a.routes.some((r) => r.method === "GET" && r.path === "/api/users/")).toBe(true);
  });

  test("connects the serializer to the email field for impact analysis", async () => {
    const a = await analyzeFixture();
    const ser = nodeId("Serializer", "backend/users/serializers.py", "UserSerializer");
    const email = nodeId("Field", "backend/users/models.py", "User", "email");
    expect(a.edges.some((e) => e.kind === "USES" && e.from === ser && e.to === email)).toBe(true);
  });
});

describe("python sidecar - DRF nested facts", () => {
  test("extracts nested serializers, router names, and nested router declarations", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-py-"));
    try {
      mkdirSync(path.join(root, "api"), { recursive: true });
      writeFileSync(
        path.join(root, "api/serializers.py"),
        [
          "from rest_framework import serializers",
          "",
          "class PostSerializer(serializers.Serializer):",
          "    title = serializers.CharField()",
          "",
          "class UserSerializer(serializers.Serializer):",
          "    display_name = serializers.CharField(source='username')",
          "    computed = serializers.SerializerMethodField()",
          "    posts = PostSerializer(many=True, read_only=True)",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(root, "api/urls.py"),
        [
          "from rest_framework.routers import DefaultRouter",
          "from rest_framework_nested.routers import NestedSimpleRouter",
          "",
          "router = DefaultRouter()",
          "router.register('users', UserViewSet)",
          "users_router = NestedSimpleRouter(router, 'users', lookup='user')",
          "users_router.register('posts', PostViewSet, basename='user-posts')",
          "",
        ].join("\n"),
      );

      const facts = await runSidecar(root, ["api/serializers.py", "api/urls.py"]);
      expect(facts.serializers).toContainEqual(
        expect.objectContaining({
          name: "UserSerializer",
          declared_fields: expect.arrayContaining([
            { name: "display_name", source: "username", kind: "field" },
            { name: "computed", source: null, kind: "method" },
          ]),
          nested: [{ field: "posts", serializer: "PostSerializer" }],
        }),
      );
      expect(facts.registrations).toContainEqual(
        expect.objectContaining({ prefix: "posts", viewset: "PostViewSet", router: "users_router" }),
      );
      expect(facts.nested_routers).toEqual([
        {
          file: "api/urls.py",
          name: "users_router",
          parent: "router",
          parent_prefix: "users",
          lookup: "user",
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("python sidecar - function-level facts", () => {
  test("extracts imports, functions and conservative function calls", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-py-calls-"));
    try {
      mkdirSync(path.join(root, "api"), { recursive: true });
      writeFileSync(
        path.join(root, "api/services.py"),
        [
          "def build_user(value):",
          "    return value",
          "",
          "def normalize(value):",
          "    return value.strip()",
        ].join("\n"),
      );
      writeFileSync(
        path.join(root, "api/views.py"),
        [
          "from .services import build_user",
          "import api.services as services",
          "",
          "def local_helper(value):",
          "    return value",
          "",
          "class UserViewSet:",
          "    def normalize(self, value):",
          "        return value",
          "",
          "    def list(self, request):",
          "        request.user.get_username()",
          "        local_helper(build_user('a'))",
          "        services.normalize('b')",
          "        return self.normalize('c')",
        ].join("\n"),
      );

      const facts = await runSidecar(root, ["api/services.py", "api/views.py"]);
      expect(facts.imports).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "api/views.py", module: "services", name: "build_user" }),
          expect.objectContaining({ file: "api/views.py", module: "api.services", name: null, alias: "services" }),
        ]),
      );
      expect(facts.functions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "api/views.py", name: "local_helper" }),
          expect.objectContaining({ file: "api/views.py", name: "UserViewSet.list" }),
          expect.objectContaining({ file: "api/views.py", name: "UserViewSet.normalize" }),
        ]),
      );
      expect(facts.function_calls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ caller: "UserViewSet.list", target: "build_user", target_module: "services" }),
          expect.objectContaining({ caller: "UserViewSet.list", target: "normalize", target_module: "api.services" }),
          expect.objectContaining({ caller: "UserViewSet.list", target: "UserViewSet.normalize", target_module: null }),
        ]),
      );
      expect(
        facts.function_calls?.some(
          (call) => call.caller === "UserViewSet.list" && call.target === "get_username",
        ),
      ).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("analyzePython - Django framework semantics", () => {
  test("links custom managers, queryset users, and signal receivers to models", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "code-mri-py-"));
    try {
      mkdirSync(path.join(root, "api"), { recursive: true });
      writeFileSync(
        path.join(root, "api/models.py"),
        [
          "from django.db import models",
          "",
          "class ActiveUserManager(models.Manager):",
          "    def active(self):",
          "        return User.objects.filter(is_active=True)",
          "",
          "class User(models.Model):",
          "    objects = ActiveUserManager()",
          "    is_active = models.BooleanField(default=True)",
          "",
        ].join("\n"),
      );
      writeFileSync(
        path.join(root, "api/signals.py"),
        [
          "from django.db.models.signals import post_save",
          "from django.dispatch import receiver",
          "from .models import User",
          "",
          "@receiver(post_save, sender=User)",
          "def sync_user(sender, instance, **kwargs):",
          "    return User.objects.get(id=instance.id)",
          "",
        ].join("\n"),
      );

      const files = ["api/models.py", "api/signals.py"];
      const facts = await runSidecar(root, files);
      expect(facts.managers).toContainEqual(
        { file: "api/models.py", name: "ActiveUserManager", line: 3 },
      );
      expect(facts.signals).toContainEqual(
        expect.objectContaining({ name: "sync_user", signal: "post_save", sender: "User" }),
      );
      expect(facts.queryset_uses).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ owner: "ActiveUserManager", model: "User", method: "filter" }),
          expect.objectContaining({ owner: "sync_user", model: "User", method: "get" }),
        ]),
      );

      const analysis = await analyzePython(root, files);
      const model = nodeId("Model", "api/models.py", "User");
      const manager = nodeId("Manager", "api/models.py", "ActiveUserManager");
      const signal = nodeId("Signal", "api/signals.py", "post_save", "User", "sync_user");
      const handler = nodeId("Function", "api/signals.py", "sync_user");

      expect(analysis.nodes.some((n) => n.id === manager && n.kind === "Manager")).toBe(true);
      expect(analysis.nodes.some((n) => n.id === signal && n.kind === "Signal")).toBe(true);
      expect(analysis.edges.some((e) => e.kind === "USES" && e.from === model && e.to === manager)).toBe(
        true,
      );
      expect(analysis.edges.some((e) => e.kind === "USES" && e.from === manager && e.to === model)).toBe(
        true,
      );
      expect(analysis.edges.some((e) => e.kind === "REGISTERED_IN" && e.from === handler && e.to === signal)).toBe(
        true,
      );
      expect(analysis.edges.some((e) => e.kind === "USES" && e.from === handler && e.to === model)).toBe(
        true,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
