import boto3
from typing import List
import uuid
from decouple import config


class FileManager:
    
    AWS_REGION_NAME=config("AWS_REGION_NAME", None)
    __s3_client = boto3.client(
        "s3",
        aws_access_key_id=config("AWS_ACCESS_KEY_ID", None),
        aws_secret_access_key=config("AWS_SECRET_ACCESS_KEY", None),
        region_name = AWS_REGION_NAME
    )
    BUCKET_NAME = config("BUCKET_NAME", None)
    s3_url_prefix = f"https://s3.{AWS_REGION_NAME}.amazonaws.com/{BUCKET_NAME}"
    
    @classmethod
    async def upload_file(cls, file, folder_name) -> List[str]:
        hash = str(uuid.uuid4())[:10]
        file_name = f"uploaded_assets/{folder_name}/{hash}_{file.filename[-10:]}"
        # UploadFile(filename='25729859.jpeg', 
        #   size=19079, 
        #   headers=Headers(
            # {
            #  'content-disposition': 'form-data; name="files"; filename="25729859.jpeg"',
            #  'content-type': 'image/jpeg'}
            # )
        # )
        cls.__s3_client.upload_fileobj(
            file.file, cls.BUCKET_NAME, file_name, ExtraArgs={'ACL': 'public-read'}
        )
        return f"{cls.s3_url_prefix}/{file_name}"


