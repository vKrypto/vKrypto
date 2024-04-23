import markdown2
import imgkit
import html2text
from weasyprint import HTML, CSS


def convert_html_to_png(html_content, output_file):
    imgkit.from_string(html_content, output_file, options={'format': 'webp'})

def convert_html_to_pdf(html_content, output_file):
    style_css = """
        section {
            page-break-inside: avoid;
        }
    """
    options = dict(
        zoom=0.9,
        encoding='UTF-8',
        font_family='Arial Unicode MS'
    )
    HTML(string=html_content).write_pdf(output_file, stylesheets=[CSS(string=style_css)], **options)
    
def convert_html_to_text(html_content, output_file):
    # content = ''.join(markdown.inlinepatterns.html.remove_tags(html_content).splitlines())
    content = html2text.html2text(html_content)
    write_content(content, output_file)

def write_content(content, output_file):
    with open(output_file, 'w') as f:
        f.write(content)

if __name__ == "__main__":
    markdown_file = "readme.md"
    build_folder = "build/"
    with open(markdown_file, 'r') as f:
        markdown_text = f.read()
    html_content = markdown2.markdown(markdown_text)

    write_content(markdown_text, build_folder + "index.md")
    write_content(html_content, build_folder + "index.html")
    convert_html_to_text(html_content, build_folder + "index.log")
    convert_html_to_png(html_content, build_folder + "index.webp")
    convert_html_to_pdf(html_content, build_folder + "index.pdf")
