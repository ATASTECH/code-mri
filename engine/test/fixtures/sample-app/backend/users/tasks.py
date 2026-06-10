from celery import shared_task


@shared_task
def send_welcome_email(user_id: int) -> None:
    """Celery task fixture — discovered via autodiscover, not a dead candidate."""
    ...
