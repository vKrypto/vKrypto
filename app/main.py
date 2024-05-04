import uvicorn
from typing import List
from fastapi import FastAPI, File, UploadFile, Form
import asyncio

from src.routers.linked_in import router as linked_in_router
from src.middleware import URLLoggerMiddleware
from src.utils.storage import FileManager


app = FastAPI()

app.add_middleware(URLLoggerMiddleware)

app.include_router(linked_in_router, prefix="/linkedin")


@app.post("/upload/")
async def upload_files(folder_name: str = Form(...), files: List[UploadFile] = File(...)):
    upload_tasks = [FileManager.upload_file(file, folder_name) for file in files]
    uploaded_files = await asyncio.gather(*upload_tasks)
    return {"uploaded_files": uploaded_files}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8001,
        reload=True,
        reload_dirs="./src"
    )