import os
import yaml
from jinja2 import Environment, FileSystemLoader

working__dir = os.path.dirname(str(__file__))

def main():
    # get root-template path 
    render_env = Environment(loader=FileSystemLoader(working__dir))
    template = render_env.get_template('index.md')
    # get context data
    with open(os.path.join(working__dir, "data.yml"), 'r') as file:
        context = yaml.safe_load(file)
    # render template
    output = template.render(context)
    print("output length: ", len(output))
    if not output:
        raise Exception("Could not render template")
    # write into final readme.md
    with open(os.path.join("README.md"), 'w') as file:
        file.write(output)
    print("successfully written template into README.md")


if __name__ == "__main__":
    main()

