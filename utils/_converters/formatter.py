from bs4 import BeautifulSoup


class HtmlFormatter:

    @classmethod
    def format_html_file(input_file, output_file):
        with open(input_file, 'r') as f:
            html_content = f.read()

        soup = BeautifulSoup(html_content, 'html.parser')
        formatted_html = soup.prettify()

        with open(input_file, 'w') as f:
            f.write(formatted_html)
    
    @classmethod
    def format_html_str(cls, html_content:str) -> str:
        soup = BeautifulSoup(html_content, 'html.parser')
        return soup.prettify()