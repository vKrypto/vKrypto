import markdown2
import imgkit
import html2text
from weasyprint import HTML, CSS


def convert_html_to_png(html_content: str, output_file: str):
    imgkit.from_string(html_content, output_file, options={'format': 'webp'})


def convert_html_to_pdf(html_content: str, output_file: str, style_css: str = "", options: dict = None):
    if options is None:
        options = {}
    style_css += """
        section {
            page-break-inside: avoid;
        }
    """
    options.update({"encoding": 'UTF-8', "font_family": 'Arial Unicode MS'})
    HTML(string=html_content).write_pdf(output_file, stylesheets=[CSS(string=style_css)], **options)


def convert_html_to_text(html_content: str, output_file: str):
    content = html2text.html2text(html_content)
    write_content(content, output_file)


def write_content(content: str, output_file: str):
    with open(output_file, 'w') as f_p:
        f_p.write(content)


def main(build_folder: str):
    markdown_file = "readme.md"
    with open(markdown_file, 'r') as f:
        markdown_text = f.read()
    html_ = markdown2.markdown(markdown_text)

    write_content(markdown_text, build_folder + "index.md")
    write_content(html_, build_folder + "index.html")
    convert_html_to_text(html_, build_folder + "index.log")
    convert_html_to_png(html_, build_folder + "index.webp")
    convert_html_to_pdf(html_, build_folder + "index.pdf")


if __name__ == "__main__":
    main(build_folder="build/")
