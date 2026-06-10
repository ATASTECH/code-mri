from fastapi import APIRouter, FastAPI
from schemas import User

app = FastAPI()
router = APIRouter(prefix="/users")


@app.get("/health")
def health():
    return {"ok": True}


@router.get("/", response_model=list[User])
def list_users():
    return []


@router.get("/{user_id}", response_model=User)
async def get_user(user_id: int):
    return {"id": user_id}


@router.post("/")
def create_user():
    return {}


app.include_router(router, prefix="/api")
