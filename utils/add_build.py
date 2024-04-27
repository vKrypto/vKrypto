from _converters import MediaConverter
import json
from custom_logger import logger
import os


def main():
    cur_dir = os.path.dirname(os.path.abspath(__file__))
    build_config = json.load(open(f"{cur_dir}/build_config.json", "r"))
    all_data = json.load(open(f"{cur_dir}/data.json", "r"))
    for working_dir, lesson_options in build_config.items():
        logger.info(f"Building lesson: {working_dir}")
        MediaConverter(working_dir=working_dir, **lesson_options).main()
        all_data[working_dir] = lesson_options
    json.dump(all_data, open(f"{cur_dir}/data.json", "w"), indent=4)
    json.dump(all_data, open("build/data.json", "w"), indent=4)


if __name__ == '__main__':
    main()
