from django.apps import AppConfig
from .checks import check_admin_app, check_dependencies
from django.core import checks
from django.utils.translation import gettext_lazy as _


class SimpleAdminConfig(AppConfig):

    default_auto_field = "django.db.models.AutoField"
    default_site = "django.contrib.admin.sites.AdminSite"
    name = "django.contrib.admin"
    verbose_name = _("Administration")

    def ready(self):
        checks.register(check_dependencies, checks.Tags.admin)
        checks.register(check_admin_app, checks.Tags.admin)


class AdminConfig(SimpleAdminConfig):

    default = True

    def ready(self):
        super().ready()
        self.module.autodiscover()
