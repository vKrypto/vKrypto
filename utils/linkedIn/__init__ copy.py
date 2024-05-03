# https://pypi.org/project/linkedin-api/


from linkedin_api import Linkedin
import json

# Authenticate using any Linkedin account credentials
api = Linkedin('ashutosh.career19@gmail.com', '**')
profile_id = "ashutosh-verma-b90083106"
# profile_id = "anshuman-verma-2a051522b"

def dump_to_json(dic_data, file_loc):
    with open(file_loc, "w") as f:
        f.write(json.dumps(dic_data, indent=4))

# GET a profile
# profile = api.get_profile(profile_id)
# dump_to_json(profile, "profile.json")

# GET a profiles contact info
contact_info = api.get_profile_posts(profile_id)
dump_to_json(contact_info, "posts.json")

# GET 1st degree connections of a given profile
# connections = api.get_profile_connections(profile_id)
# dump_to_json(connections, "connections.json")