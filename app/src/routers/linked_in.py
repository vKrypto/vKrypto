from fastapi import Query, APIRouter, Request
from fastapi.responses import RedirectResponse
from typing import Optional
from .helper.linkedin import LinkedApiManager

router = APIRouter()


@router.get("/login/initialize")
async def initialize_login(request: Request):
    linkedin_url = LinkedApiManager.get_authorization_redirect_url(state="user_id_etc..")
    return RedirectResponse(url=linkedin_url)


@router.get("/login/callback")
async def login_callback(code: Optional[str] = Query(None), error=None, error_description=None, state: Optional[str] = Query(None)):
    if error:
        return {'error': error, "code": code, "error_description": error_description, "state": state}
    api_manager = LinkedApiManager()
    is_authenticated, resp = api_manager.get_access_token(code)
    if not is_authenticated:
        return resp
    response = api_manager.make_authenticated_request('GET', '/v2/me')
    if response:
        print(response.json())
    return response.json()

