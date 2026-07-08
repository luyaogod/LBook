from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import engine, Base
import models  # noqa: F401 — ensure models are loaded for table creation
from routers.hello import router as hello_router
from routers.pdfs import router as pdfs_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create all tables
    Base.metadata.create_all(bind=engine)
    yield
    # Shutdown: nothing to clean up for SQLite


app = FastAPI(
    title="LBook Backend",
    description="Backend API for LBook application",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS middleware — allows the Vite dev server to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(hello_router)
app.include_router(pdfs_router)


@app.get("/")
async def root():
    return {"message": "LBook Backend API"}
