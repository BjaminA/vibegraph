from django.core.exceptions import SuspiciousOperation


class DisallowedModelAdminLookup(SuspiciousOperation):

    pass


class DisallowedModelAdminToField(SuspiciousOperation):

    pass
