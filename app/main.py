from fastapi import FastAPI
import uvicorn

from src.routers.linked_in import router as linked_in_router
from src.middleware import URLLoggerMiddleware

app = FastAPI()

app.add_middleware(URLLoggerMiddleware)
app.include_router(linked_in_router, prefix="/linkedin")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
        reload_dirs="./src"
    )