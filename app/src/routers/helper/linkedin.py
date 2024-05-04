import requests
import urllib.parse
import jwt
from decouple import config





class LinkedApiManager:
    client_id = config("LINKED_IN_CLIENT_ID", None)
    client_secret = config("LINKED_IN_CLIENT_SECRET", None)
    scope = "openid profile w_member_social email"
    def __init__(self):
        self.base_url = "https://www.linkedin.com/oauth/v2/"
        self.token_url = self.base_url + "accessToken"
        self.refresh_url = self.base_url + "refreshToken"
        self.auth_token = None
        self.refresh_token = None
    
    @classmethod
    def get_authorization_redirect_url(cls, state:str="foobar") -> str:
        url = urllib.parse.quote(config("LINKED_IN_REDIRECT_URI", None))
        return "https://www.linkedin.com/oauth/v2/authorization?response_type=code&" \
                + f"client_id={cls.client_id}&redirect_uri={url}&state={state}&scope={cls.scope}"

    def get_access_token(self, code):
        data = {
            'grant_type': 'authorization_code',
            'code': code,
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'redirect_uri': config("LINKED_IN_REDIRECT_URI", None),
        }
        response = requests.post(self.token_url, data=data)
        if response.status_code == 200:
            token_data = response.json()
            self.auth_token = token_data['access_token']
            self.refresh_token = token_data.get('refresh_token', None)
            self.data = jwt.decode(token_data["id_token"], options={"verify_signature": False})
            print(self.data)
            return True, {}
        else:
            return False, response.json()

    def refresh_access_token(self):
        data = {
            'grant_type': 'refresh_token',
            'refresh_token': self.refresh_token,
            'client_id': self.client_id,
            'client_secret': self.client_secret
        }
        response = requests.post(self.refresh_url, data=data)
        if response.status_code == 200:
            token_data = response.json()
            self.auth_token = token_data['access_token']
            self.refresh_token = token_data.get('refresh_token', None)
            self.data = jwt.decode(token_data["id_token"], options={"verify_signature": False})
            print(self.data)
            return True
        else:
            return False
    
    def make_authenticated_request(self, method, url, **kwargs):
        headers = kwargs.get('headers', {})
        if self.auth_token is None:
            return None  # No token available
        headers['Authorization'] = f'Bearer {self.auth_token}'
        kwargs['headers'] = headers
        url = "https://api.linkedin.com" + url
        print(url, headers)
        response = requests.request(method, url, **kwargs)
        if response.status_code == 401:  # Token expired
            if self.refresh_access_token():  # Try to refresh token
                headers['Authorization'] = f'Bearer {self.auth_token}'
                kwargs['headers'] = headers
                response = requests.request(method, url, **kwargs)
        return response
