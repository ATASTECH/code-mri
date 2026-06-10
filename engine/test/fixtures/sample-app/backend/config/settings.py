import os

SECRET_KEY = "dev-only"
DEBUG = True

ROOT_URLCONF = "config.urls"

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "users",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "app"),
        "HOST": os.environ.get("POSTGRES_HOST", "postgres"),
    }
}

CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
