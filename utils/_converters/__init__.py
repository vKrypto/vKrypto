import markdown2
import imgkit
import json
import os
from typing import Dict
import html2text
import shutil
from pathlib import Path
from weasyprint import HTML, CSS
from jinja2 import Environment, FileSystemLoader, select_autoescape
from .formatter import HtmlFormatter


cur_dir = os.path.dirname(os.path.realpath(__file__))
src_dir = os.path.dirname(os.path.realpath(__name__))
env = Environment(
    loader=FileSystemLoader([
        cur_dir,
        os.path.join(cur_dir,"public"),
        os.path.join(cur_dir,"public", "templates")
    ]),
    autoescape=select_autoescape(['html', 'xml'])
)

class MediaConverter:
    def __init__(
            self, working_dir: str,
            style_css: str = "", pdf_options: dict = None, image_format: str = None,
            **kwargs
    ):
        self.working_dir = Path("src", working_dir)
        self.build_folder = Path("build", working_dir)
        self.build_folder.mkdir(parents=True, exist_ok=True)  # make sure the build folder exists
        self.image_format = image_format or "webp"
        self.style_css = style_css
        if pdf_options is None:
            pdf_options = {}
        self.pdf_options = pdf_options
        self.pdf_options.update({"encoding": 'UTF-8', "font_family": 'Arial Unicode MS'})
        self.current_dir = os.path.dirname(os.path.realpath(__file__))
        self.config = self.__read_config() or {}
        self.images = []
        self.check_assets()
        self.tags = self.config.get('tags', [])

    @property
    def context(self):
        return {
            "css_str": f"<style>{self.style_css}</style>" if self.style_css else "",
            "html_str": self.html_str,
            "tags": " ".join(self.tags),
            "config": self.config,
            "images": self.images or []
        }
        
    def _convert_html_to_png(self, output_file: str):
        imgkit.from_string(self.html_str, self._add_build_dir(output_file), options={'format': self.image_format})

    def _convert_html_to_pdf(self, output_file: str):
        HTML(string=self.html_str).write_pdf(
            self._add_build_dir(output_file), stylesheets=[CSS(string=self.style_css)], **self.pdf_options
        )

    def _convert_html_to_text(self, output_file: str):
        content = html2text.html2text(self.html_str)
        self.__write_content(content.replace("**", ""), output_file)

    def _add_build_dir(self, output_file):
        return self.build_folder.joinpath(output_file)

    def __write_content(self, content:str, output_file: str):
        with open(self._add_build_dir(output_file), 'w') as f_p:
            f_p.write(content)
        
    def __read_config(self) -> Dict:
        file_ = self.working_dir.joinpath("config.json")
        if os.path.exists(file_):
            with open(file_, "r") as file:
                return json.load(file)

    def parse_html(self) -> str:
        template = env.get_template('index.html')
        html_str = template.render(**self.context)
        return HtmlFormatter.format_html_str(html_str)

    def _check_image_assets(self):
        _dir = self.working_dir.joinpath("assets", "images")
        if os.path.exists(_dir):
            self.images = [
                "./assets/images/" +  x 
                # "file://" + str(os.path.join(src_dir, self.build_folder.joinpath("assets/images/" + x))) 
                for x in os.listdir(_dir)]
            self.images = []

    def check_assets(self):
        from_dir = self.working_dir.joinpath("assets")
        if os.path.exists(from_dir):
            self._check_image_assets()
            to_dir = os.path.join(self.build_folder, "assets")
            shutil.copytree(
                from_dir, to_dir, 
                dirs_exist_ok=True
            )

    def main(self):
        markdown_file = self.working_dir.joinpath("readme.md")
        with open(markdown_file, 'r') as f:
            markdown_text = f.read()

        self.html_str = markdown2.markdown(markdown_text)
        self.html_str = self.parse_html()

        self.__write_content(markdown_text, "readme.md")
        self.__write_content(self.html_str, "index.html")
        self._convert_html_to_text("index.log")
        self._convert_html_to_png("index." + self.image_format.lower())
        self._convert_html_to_pdf("index.pdf")
