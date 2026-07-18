from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from .routes import cases, visits  # noqa: E402
from .services import store  # noqa: E402

app = FastAPI(title="Bridge API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    store.load_cases()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "bridge-api"}


app.include_router(cases.router)
app.include_router(visits.router)
