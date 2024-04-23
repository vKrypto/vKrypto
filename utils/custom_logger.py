import logging.config
import os
from datetime import datetime
from pathlib import Path
import platform


root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
current_date = str(datetime.today().date())
log_path = os.path.join(root_dir, "logs")
path = Path(log_path)
if not path.exists():
    os.mkdir(log_path)
os_name = platform.system()

# Logging configuration as a dictionary
logging_config = {
    "version": 1,
    "formatters": {
        "standard": {
            "format": f"%(asctime)s [{os_name}:%(name)s:%(levelname)s] [PID:%(process)d] [%(module)s.%(funcName)s:%(lineno)d]: %(message)s",
        },
    },
    "handlers": {
        "console_handler": {
            "class": "logging.StreamHandler",
            "level": "WARNING",  # Set the desired console log level
            "formatter": "standard",
        },
        "file_handler": {
            "class": "logging.FileHandler",
            "filename": os.path.join(root_dir, "logs", f"build-logs-{current_date}.log"),
            "level": "INFO",
            "formatter": "standard",
        },
    },
    "loggers": {
        "pytest": {
            "handlers": ["file_handler"],
            "level": "INFO",
        },
    },
}

# Define a mapping between log level names and their corresponding integers
log_level_mapping = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}

# Configure the logging system using dictConfig
logging.config.dictConfig(logging_config)
logger = logging.getLogger("builder")
logger.log(logging.INFO, "Execution started")
