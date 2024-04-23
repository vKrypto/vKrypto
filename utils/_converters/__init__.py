import markdown2
import imgkit
import html2text
from pathlib import Path
from weasyprint import HTML, CSS


class MediaConverter:
    def __init__(
            self, working_dir: str,
            style_css: str = "", pdf_options: dict = None, image_format: str = None
    ):
        self.working_dir = Path("src", working_dir)
        self.build_folder = Path("build", working_dir)
        self.build_folder.mkdir(parents=True, exist_ok=True)  # make sure the build folder exists
        self.image_format = image_format or "webp"
        self.style_css = style_css + "section {page-break-inside: avoid;}"
        if pdf_options is None:
            pdf_options = {}
        self.pdf_options = pdf_options
        self.pdf_options.update({"encoding": 'UTF-8', "font_family": 'Arial Unicode MS'})

    def _convert_html_to_png(self, html_content: str, output_file: str):
        imgkit.from_string(html_content, self._add_build_dir(output_file), options={'format': self.image_format})

    def _convert_html_to_pdf(self, html_content: str, output_file: str):
        HTML(string=html_content).write_pdf(
            self._add_build_dir(output_file), stylesheets=[CSS(string=self.style_css)], **self.pdf_options
        )

    def _convert_html_to_text(self, html_content: str, output_file: str):
        content = html2text.html2text(html_content)
        self.__write_content(content, output_file)

    def _add_build_dir(self, output_file):
        return self.build_folder.joinpath(output_file)

    def __write_content(self, content: str, output_file: str):
        with open(self._add_build_dir(output_file), 'w') as f_p:
            f_p.write(content)

    def main(self):
        markdown_file = self.working_dir.joinpath("readme.md")
        with open(markdown_file, 'r') as f:
            markdown_text = f.read()
        html_ = markdown2.markdown(markdown_text)

        self.__write_content(markdown_text, "readme.md")
        self.__write_content(html_, "index.html")
        self._convert_html_to_text(html_, "index.log")
        self._convert_html_to_png(html_, "index." + self.image_format.lower())
        self._convert_html_to_pdf(html_, "index.pdf")
