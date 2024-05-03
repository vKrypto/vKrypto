# https://pypi.org/project/linkedin/

from linkedin import *
import json

profile_id = "ashutosh-verma-b90083106"

def dump_to_json(dic_data, file_loc):
    with open(file_loc, "w") as f:
        f.write(json.dumps(dic_data, indent=4))

l_api = LinkedinAPI(api_key='86hunnabauzv6z',  
api_secret='7HDumVzJjMmzC0Al',  
callback_url='http://www.example.com/callback/',  
permissions=["r_network"])  
  
auth_props = l_api.get_authentication_tokens()  
auth_url = auth_props['auth_url']  
  
#Store this token in a session or something for later use in the next step.  
oauth_token_secret = auth_props['oauth_token_secret']  
  
print(auth_props)