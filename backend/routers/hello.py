from fastapi import APIRouter

from schemas import HelloResponse

router = APIRouter(
    prefix="/api",
    tags=["hello"],
)


@router.get("/hello", response_model=HelloResponse)
async def hello():
    return {"message": "Hello World"}
