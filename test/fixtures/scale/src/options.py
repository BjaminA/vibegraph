import copy
import json
import re
from functools import partial, update_wrapper
from urllib.parse import quote as urlquote

from django import forms
from django.conf import settings
from django.contrib import messages
from . import helpers, widgets
from .checks import (
    BaseModelAdminChecks,
    InlineModelAdminChecks,
    ModelAdminChecks,
)
from .decorators import display
from .exceptions import DisallowedModelAdminToField
from .templatetags.admin_urls import add_preserved_filters
from .utils import (
    NestedObjects,
    construct_change_message,
    flatten_fieldsets,
    get_deleted_objects,
    lookup_spawns_duplicates,
    model_format_dict,
    model_ngettext,
    quote,
    unquote,
)
from .widgets import AutocompleteSelect, AutocompleteSelectMultiple
from django.contrib.auth import get_permission_codename
from django.core.exceptions import (
    FieldDoesNotExist,
    FieldError,
    PermissionDenied,
    ValidationError,
)
from django.core.paginator import Paginator
from django.db import models, router, transaction
from django.db.models.constants import LOOKUP_SEP
from django.forms.formsets import DELETION_FIELD_NAME, all_valid
from django.forms.models import (
    BaseInlineFormSet,
    inlineformset_factory,
    modelform_defines_fields,
    modelform_factory,
    modelformset_factory,
)
from django.forms.widgets import CheckboxSelectMultiple, SelectMultiple
from django.http import HttpResponseRedirect
from django.http.response import HttpResponseBase
from django.template.response import SimpleTemplateResponse, TemplateResponse
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.utils.html import format_html
from django.utils.http import urlencode
from django.utils.safestring import mark_safe
from django.utils.text import (
    capfirst,
    format_lazy,
    get_text_list,
    smart_split,
    unescape_string_literal,
)
from django.utils.translation import gettext as _
from django.utils.translation import ngettext
from django.views.decorators.csrf import csrf_protect
from django.views.generic import RedirectView

IS_POPUP_VAR = "_popup"
TO_FIELD_VAR = "_to_field"


HORIZONTAL, VERTICAL = 1, 2


def get_content_type_for_model(obj):
    
    
    from django.contrib.contenttypes.models import ContentType

    return ContentType.objects.get_for_model(obj, for_concrete_model=False)


def get_ul_class(radio_style):
    return "radiolist" if radio_style == VERTICAL else "radiolist inline"


class IncorrectLookupParameters(Exception):
    pass





FORMFIELD_FOR_DBFIELD_DEFAULTS = {
    models.DateTimeField: {
        "form_class": forms.SplitDateTimeField,
        "widget": widgets.AdminSplitDateTime,
    },
    models.DateField: {"widget": widgets.AdminDateWidget},
    models.TimeField: {"widget": widgets.AdminTimeWidget},
    models.TextField: {"widget": widgets.AdminTextareaWidget},
    models.URLField: {"widget": widgets.AdminURLFieldWidget},
    models.IntegerField: {"widget": widgets.AdminIntegerFieldWidget},
    models.BigIntegerField: {"widget": widgets.AdminBigIntegerFieldWidget},
    models.CharField: {"widget": widgets.AdminTextInputWidget},
    models.ImageField: {"widget": widgets.AdminFileWidget},
    models.FileField: {"widget": widgets.AdminFileWidget},
    models.EmailField: {"widget": widgets.AdminEmailInputWidget},
    models.UUIDField: {"widget": widgets.AdminUUIDInputWidget},
}

csrf_protect_m = method_decorator(csrf_protect)


class BaseModelAdmin(metaclass=forms.MediaDefiningClass):

    autocomplete_fields = ()
    raw_id_fields = ()
    fields = None
    exclude = None
    fieldsets = None
    form = forms.ModelForm
    filter_vertical = ()
    filter_horizontal = ()
    radio_fields = {}
    prepopulated_fields = {}
    formfield_overrides = {}
    readonly_fields = ()
    ordering = None
    sortable_by = None
    view_on_site = True
    show_full_result_count = True
    checks_class = BaseModelAdminChecks

    def check(self, **kwargs):
        return self.checks_class().check(self, **kwargs)

    def __init__(self):
        
        
        overrides = copy.deepcopy(FORMFIELD_FOR_DBFIELD_DEFAULTS)
        for k, v in self.formfield_overrides.items():
            overrides.setdefault(k, {}).update(v)
        self.formfield_overrides = overrides

    def formfield_for_dbfield(self, db_field, request, **kwargs):
        
        
        if db_field.choices:
            return self.formfield_for_choice_field(db_field, request, **kwargs)

        
        if isinstance(db_field, (models.ForeignKey, models.ManyToManyField)):
            
            
            
            
            if db_field.__class__ in self.formfield_overrides:
                kwargs = {**self.formfield_overrides[db_field.__class__], **kwargs}

            
            if isinstance(db_field, models.ForeignKey):
                formfield = self.formfield_for_foreignkey(db_field, request, **kwargs)
            elif isinstance(db_field, models.ManyToManyField):
                formfield = self.formfield_for_manytomany(db_field, request, **kwargs)

            
            
            
            
            if formfield and db_field.name not in self.raw_id_fields:
                related_modeladmin = self.admin_site._registry.get(
                    db_field.remote_field.model
                )
                wrapper_kwargs = {}
                if related_modeladmin:
                    wrapper_kwargs.update(
                        can_add_related=related_modeladmin.has_add_permission(request),
                        can_change_related=related_modeladmin.has_change_permission(
                            request
                        ),
                        can_delete_related=related_modeladmin.has_delete_permission(
                            request
                        ),
                        can_view_related=related_modeladmin.has_view_permission(
                            request
                        ),
                    )
                formfield.widget = widgets.RelatedFieldWidgetWrapper(
                    formfield.widget,
                    db_field.remote_field,
                    self.admin_site,
                    **wrapper_kwargs,
                )

            return formfield

        
        
        for klass in db_field.__class__.mro():
            if klass in self.formfield_overrides:
                kwargs = {**copy.deepcopy(self.formfield_overrides[klass]), **kwargs}
                return db_field.formfield(**kwargs)

        
        return db_field.formfield(**kwargs)

    def formfield_for_choice_field(self, db_field, request, **kwargs):
        
        if db_field.name in self.radio_fields:
            
            if "widget" not in kwargs:
                kwargs["widget"] = widgets.AdminRadioSelect(
                    attrs={
                        "class": get_ul_class(self.radio_fields[db_field.name]),
                    }
                )
            if "choices" not in kwargs:
                kwargs["choices"] = db_field.get_choices(
                    include_blank=db_field.blank, blank_choice=[("", _("None"))]
                )
        return db_field.formfield(**kwargs)

    def get_field_queryset(self, db, db_field, request):
        related_admin = self.admin_site._registry.get(db_field.remote_field.model)
        if related_admin is not None:
            ordering = related_admin.get_ordering(request)
            if ordering is not None and ordering != ():
                return db_field.remote_field.model._default_manager.using(db).order_by(
                    *ordering
                )
        return None

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        db = kwargs.get("using")

        if "widget" not in kwargs:
            if db_field.name in self.get_autocomplete_fields(request):
                kwargs["widget"] = AutocompleteSelect(
                    db_field, self.admin_site, using=db
                )
            elif db_field.name in self.raw_id_fields:
                kwargs["widget"] = widgets.ForeignKeyRawIdWidget(
                    db_field.remote_field, self.admin_site, using=db
                )
            elif db_field.name in self.radio_fields:
                kwargs["widget"] = widgets.AdminRadioSelect(
                    attrs={
                        "class": get_ul_class(self.radio_fields[db_field.name]),
                    }
                )
                kwargs["empty_label"] = (
                    kwargs.get("empty_label", _("None")) if db_field.blank else None
                )

        if "queryset" not in kwargs:
            queryset = self.get_field_queryset(db, db_field, request)
            if queryset is not None:
                kwargs["queryset"] = queryset

        return db_field.formfield(**kwargs)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        
        
        if not db_field.remote_field.through._meta.auto_created:
            return None
        db = kwargs.get("using")

        if "widget" not in kwargs:
            autocomplete_fields = self.get_autocomplete_fields(request)
            if db_field.name in autocomplete_fields:
                kwargs["widget"] = AutocompleteSelectMultiple(
                    db_field,
                    self.admin_site,
                    using=db,
                )
            elif db_field.name in self.raw_id_fields:
                kwargs["widget"] = widgets.ManyToManyRawIdWidget(
                    db_field.remote_field,
                    self.admin_site,
                    using=db,
                )
            elif db_field.name in [*self.filter_vertical, *self.filter_horizontal]:
                kwargs["widget"] = widgets.FilteredSelectMultiple(
                    db_field.verbose_name, db_field.name in self.filter_vertical
                )
        if "queryset" not in kwargs:
            queryset = self.get_field_queryset(db, db_field, request)
            if queryset is not None:
                kwargs["queryset"] = queryset

        form_field = db_field.formfield(**kwargs)
        if (
            isinstance(form_field.widget, SelectMultiple)
            and form_field.widget.allow_multiple_selected
            and not isinstance(
                form_field.widget, (CheckboxSelectMultiple, AutocompleteSelectMultiple)
            )
        ):
            msg = _(
                "Hold down “Control”, or “Command” on a Mac, to select more than one."
            )
            help_text = form_field.help_text
            form_field.help_text = (
                format_lazy("{} {}", help_text, msg) if help_text else msg
            )
        return form_field

    def get_autocomplete_fields(self, request):
        return self.autocomplete_fields

    def get_view_on_site_url(self, obj=None):
        if obj is None or not self.view_on_site:
            return None

        if callable(self.view_on_site):
            return self.view_on_site(obj)
        elif hasattr(obj, "get_absolute_url"):
            
            return reverse(
                "admin:view_on_site",
                kwargs={
                    "content_type_id": get_content_type_for_model(obj).pk,
                    "object_id": obj.pk,
                },
                current_app=self.admin_site.name,
            )

    def get_empty_value_display(self):
        try:
            return mark_safe(self.empty_value_display)
        except AttributeError:
            return mark_safe(self.admin_site.empty_value_display)

    def get_exclude(self, request, obj=None):
        return self.exclude

    def get_fields(self, request, obj=None):
        if self.fields:
            return self.fields
        
        form = self._get_form_for_get_fields(request, obj)
        return [*form.base_fields, *self.get_readonly_fields(request, obj)]

    def get_fieldsets(self, request, obj=None):
        if self.fieldsets:
            return self.fieldsets
        return [(None, {"fields": self.get_fields(request, obj)})]

    def get_inlines(self, request, obj):
        return self.inlines

    def get_ordering(self, request):
        return self.ordering or ()  

    def get_readonly_fields(self, request, obj=None):
        return self.readonly_fields

    def get_prepopulated_fields(self, request, obj=None):
        return self.prepopulated_fields

    def get_queryset(self, request):
        qs = self.model._default_manager.get_queryset()
        
        ordering = self.get_ordering(request)
        if ordering:
            qs = qs.order_by(*ordering)
        return qs

    def get_sortable_by(self, request):
        return (
            self.sortable_by
            if self.sortable_by is not None
            else self.get_list_display(request)
        )

    def lookup_allowed(self, lookup, value):
        from .filters import SimpleListFilter

        model = self.model
        
        
        
        for fk_lookup in model._meta.related_fkey_lookups:
            
            if callable(fk_lookup):
                fk_lookup = fk_lookup()
            if (lookup, value) in widgets.url_params_from_lookup_dict(
                fk_lookup
            ).items():
                return True

        relation_parts = []
        prev_field = None
        for part in lookup.split(LOOKUP_SEP):
            try:
                field = model._meta.get_field(part)
            except FieldDoesNotExist:
                
                
                break
            
            
            
            if not prev_field or (
                prev_field.is_relation
                and field not in prev_field.path_infos[-1].target_fields
            ):
                relation_parts.append(part)
            if not getattr(field, "path_infos", None):
                
                
                break
            prev_field = field
            model = field.path_infos[-1].to_opts.model

        if len(relation_parts) <= 1:
            
            return True
        valid_lookups = {self.date_hierarchy}
        for filter_item in self.list_filter:
            if isinstance(filter_item, type) and issubclass(
                filter_item, SimpleListFilter
            ):
                valid_lookups.add(filter_item.parameter_name)
            elif isinstance(filter_item, (list, tuple)):
                valid_lookups.add(filter_item[0])
            else:
                valid_lookups.add(filter_item)

        
        return not {
            LOOKUP_SEP.join(relation_parts),
            LOOKUP_SEP.join(relation_parts + [part]),
        }.isdisjoint(valid_lookups)

    def to_field_allowed(self, request, to_field):
        try:
            field = self.opts.get_field(to_field)
        except FieldDoesNotExist:
            return False

        
        
        if field.primary_key:
            return True

        
        
        for many_to_many in self.opts.many_to_many:
            if many_to_many.m2m_target_field_name() == to_field:
                return True

        
        
        registered_models = set()
        for model, admin in self.admin_site._registry.items():
            registered_models.add(model)
            for inline in admin.inlines:
                registered_models.add(inline.model)

        related_objects = (
            f
            for f in self.opts.get_fields(include_hidden=True)
            if (f.auto_created and not f.concrete)
        )
        for related_object in related_objects:
            related_model = related_object.related_model
            remote_field = related_object.field.remote_field
            if (
                any(issubclass(model, related_model) for model in registered_models)
                and hasattr(remote_field, "get_related_field")
                and remote_field.get_related_field() == field
            ):
                return True

        return False

    def has_add_permission(self, request):
        opts = self.opts
        codename = get_permission_codename("add", opts)
        return request.user.has_perm("%s.%s" % (opts.app_label, codename))

    def has_change_permission(self, request, obj=None):
        opts = self.opts
        codename = get_permission_codename("change", opts)
        return request.user.has_perm("%s.%s" % (opts.app_label, codename))

    def has_delete_permission(self, request, obj=None):
        opts = self.opts
        codename = get_permission_codename("delete", opts)
        return request.user.has_perm("%s.%s" % (opts.app_label, codename))

    def has_view_permission(self, request, obj=None):
        opts = self.opts
        codename_view = get_permission_codename("view", opts)
        codename_change = get_permission_codename("change", opts)
        return request.user.has_perm(
            "%s.%s" % (opts.app_label, codename_view)
        ) or request.user.has_perm("%s.%s" % (opts.app_label, codename_change))

    def has_view_or_change_permission(self, request, obj=None):
        return self.has_view_permission(request, obj) or self.has_change_permission(
            request, obj
        )

    def has_module_permission(self, request):
        return request.user.has_module_perms(self.opts.app_label)


class ModelAdmin(BaseModelAdmin):

    list_display = ("__str__",)
    list_display_links = ()
    list_filter = ()
    list_select_related = False
    list_per_page = 100
    list_max_show_all = 200
    list_editable = ()
    search_fields = ()
    search_help_text = None
    date_hierarchy = None
    save_as = False
    save_as_continue = True
    save_on_top = False
    paginator = Paginator
    preserve_filters = True
    inlines = ()

    
    add_form_template = None
    change_form_template = None
    change_list_template = None
    delete_confirmation_template = None
    delete_selected_confirmation_template = None
    object_history_template = None
    popup_response_template = None

    
    actions = ()
    action_form = helpers.ActionForm
    actions_on_top = True
    actions_on_bottom = False
    actions_selection_counter = True
    checks_class = ModelAdminChecks

    def __init__(self, model, admin_site):
        self.model = model
        self.opts = model._meta
        self.admin_site = admin_site
        super().__init__()

    def __str__(self):
        return "%s.%s" % (self.opts.app_label, self.__class__.__name__)

    def __repr__(self):
        return (
            f"<{self.__class__.__qualname__}: model={self.model.__qualname__} "
            f"site={self.admin_site!r}>"
        )

    def get_inline_instances(self, request, obj=None):
        inline_instances = []
        for inline_class in self.get_inlines(request, obj):
            inline = inline_class(self.model, self.admin_site)
            if request:
                if not (
                    inline.has_view_or_change_permission(request, obj)
                    or inline.has_add_permission(request, obj)
                    or inline.has_delete_permission(request, obj)
                ):
                    continue
                if not inline.has_add_permission(request, obj):
                    inline.max_num = 0
            inline_instances.append(inline)

        return inline_instances

    def get_urls(self):
        from django.urls import path

        def wrap(view):
            def wrapper(*args, **kwargs):
                return self.admin_site.admin_view(view)(*args, **kwargs)

            wrapper.model_admin = self
            return update_wrapper(wrapper, view)

        info = self.opts.app_label, self.opts.model_name

        return [
            path("", wrap(self.changelist_view), name="%s_%s_changelist" % info),
            path("add/", wrap(self.add_view), name="%s_%s_add" % info),
            path(
                "<path:object_id>/history/",
                wrap(self.history_view),
                name="%s_%s_history" % info,
            ),
            path(
                "<path:object_id>/delete/",
                wrap(self.delete_view),
                name="%s_%s_delete" % info,
            ),
            path(
                "<path:object_id>/change/",
                wrap(self.change_view),
                name="%s_%s_change" % info,
            ),
            
            path(
                "<path:object_id>/",
                wrap(
                    RedirectView.as_view(
                        pattern_name="%s:%s_%s_change"
                        % ((self.admin_site.name,) + info)
                    )
                ),
            ),
        ]

    @property
    def urls(self):
        return self.get_urls()

    @property
    def media(self):
        extra = "" if settings.DEBUG else ".min"
        js = [
            "vendor/jquery/jquery%s.js" % extra,
            "jquery.init.js",
            "core.js",
            "admin/RelatedObjectLookups.js",
            "actions.js",
            "urlify.js",
            "prepopulate.js",
            "vendor/xregexp/xregexp%s.js" % extra,
        ]
        return forms.Media(js=["admin/js/%s" % url for url in js])

    def get_model_perms(self, request):
        return {
            "add": self.has_add_permission(request),
            "change": self.has_change_permission(request),
            "delete": self.has_delete_permission(request),
            "view": self.has_view_permission(request),
        }

    def _get_form_for_get_fields(self, request, obj):
        return self.get_form(request, obj, fields=None)

    def get_form(self, request, obj=None, change=False, **kwargs):
        if "fields" in kwargs:
            fields = kwargs.pop("fields")
        else:
            fields = flatten_fieldsets(self.get_fieldsets(request, obj))
        excluded = self.get_exclude(request, obj)
        exclude = [] if excluded is None else list(excluded)
        readonly_fields = self.get_readonly_fields(request, obj)
        exclude.extend(readonly_fields)
        
        
        if (
            change
            and hasattr(request, "user")
            and not self.has_change_permission(request, obj)
        ):
            exclude.extend(fields)
        if excluded is None and hasattr(self.form, "_meta") and self.form._meta.exclude:
            
            
            exclude.extend(self.form._meta.exclude)
        
        
        exclude = exclude or None

        
        new_attrs = dict.fromkeys(
            f for f in readonly_fields if f in self.form.declared_fields
        )
        form = type(self.form.__name__, (self.form,), new_attrs)

        defaults = {
            "form": form,
            "fields": fields,
            "exclude": exclude,
            "formfield_callback": partial(self.formfield_for_dbfield, request=request),
            **kwargs,
        }

        if defaults["fields"] is None and not modelform_defines_fields(
            defaults["form"]
        ):
            defaults["fields"] = forms.ALL_FIELDS

        try:
            return modelform_factory(self.model, **defaults)
        except FieldError as e:
            raise FieldError(
                "%s. Check fields/fieldsets/exclude attributes of class %s."
                % (e, self.__class__.__name__)
            )

    def get_changelist(self, request, **kwargs):
        from .views.main import ChangeList

        return ChangeList

    def get_changelist_instance(self, request):
        list_display = self.get_list_display(request)
        list_display_links = self.get_list_display_links(request, list_display)
        
        if self.get_actions(request):
            list_display = ["action_checkbox", *list_display]
        sortable_by = self.get_sortable_by(request)
        ChangeList = self.get_changelist(request)
        return ChangeList(
            request,
            self.model,
            list_display,
            list_display_links,
            self.get_list_filter(request),
            self.date_hierarchy,
            self.get_search_fields(request),
            self.get_list_select_related(request),
            self.list_per_page,
            self.list_max_show_all,
            self.list_editable,
            self,
            sortable_by,
            self.search_help_text,
        )

    def get_object(self, request, object_id, from_field=None):
        queryset = self.get_queryset(request)
        model = queryset.model
        field = (
            model._meta.pk if from_field is None else model._meta.get_field(from_field)
        )
        try:
            object_id = field.to_python(object_id)
            return queryset.get(**{field.name: object_id})
        except (model.DoesNotExist, ValidationError, ValueError):
            return None

    def get_changelist_form(self, request, **kwargs):
        defaults = {
            "formfield_callback": partial(self.formfield_for_dbfield, request=request),
            **kwargs,
        }
        if defaults.get("fields") is None and not modelform_defines_fields(
            defaults.get("form")
        ):
            defaults["fields"] = forms.ALL_FIELDS

        return modelform_factory(self.model, **defaults)

    def get_changelist_formset(self, request, **kwargs):
        defaults = {
            "formfield_callback": partial(self.formfield_for_dbfield, request=request),
            **kwargs,
        }
        return modelformset_factory(
            self.model,
            self.get_changelist_form(request),
            extra=0,
            fields=self.list_editable,
            **defaults,
        )

    def get_formsets_with_inlines(self, request, obj=None):
        for inline in self.get_inline_instances(request, obj):
            yield inline.get_formset(request, obj), inline

    def get_paginator(
        self, request, queryset, per_page, orphans=0, allow_empty_first_page=True
    ):
        return self.paginator(queryset, per_page, orphans, allow_empty_first_page)

    def log_addition(self, request, obj, message):
        from .models import ADDITION, LogEntry

        return LogEntry.objects.log_action(
            user_id=request.user.pk,
            content_type_id=get_content_type_for_model(obj).pk,
            object_id=obj.pk,
            object_repr=str(obj),
            action_flag=ADDITION,
            change_message=message,
        )

    def log_change(self, request, obj, message):
        from .models import CHANGE, LogEntry

        return LogEntry.objects.log_action(
            user_id=request.user.pk,
            content_type_id=get_content_type_for_model(obj).pk,
            object_id=obj.pk,
            object_repr=str(obj),
            action_flag=CHANGE,
            change_message=message,
        )

    def log_deletion(self, request, obj, object_repr):
        from .models import DELETION, LogEntry

        return LogEntry.objects.log_action(
            user_id=request.user.pk,
            content_type_id=get_content_type_for_model(obj).pk,
            object_id=obj.pk,
            object_repr=object_repr,
            action_flag=DELETION,
        )

    @display(description=mark_safe('<input type="checkbox" id="action-toggle">'))
    def action_checkbox(self, obj):
        return helpers.checkbox.render(helpers.ACTION_CHECKBOX_NAME, str(obj.pk))

    @staticmethod
    def _get_action_description(func, name):
        return getattr(func, "short_description", capfirst(name.replace("_", " ")))

    def _get_base_actions(self):
        actions = []
        base_actions = (self.get_action(action) for action in self.actions or [])
        
        base_actions = [action for action in base_actions if action]
        base_action_names = {name for _, name, _ in base_actions}

        
        for name, func in self.admin_site.actions:
            if name in base_action_names:
                continue
            description = self._get_action_description(func, name)
            actions.append((func, name, description))
        
        actions.extend(base_actions)
        return actions

    def _filter_actions_by_permissions(self, request, actions):
        filtered_actions = []
        for action in actions:
            callable = action[0]
            if not hasattr(callable, "allowed_permissions"):
                filtered_actions.append(action)
                continue
            permission_checks = (
                getattr(self, "has_%s_permission" % permission)
                for permission in callable.allowed_permissions
            )
            if any(has_permission(request) for has_permission in permission_checks):
                filtered_actions.append(action)
        return filtered_actions

    def get_actions(self, request):
        
        
        if self.actions is None or IS_POPUP_VAR in request.GET:
            return {}
        actions = self._filter_actions_by_permissions(request, self._get_base_actions())
        return {name: (func, name, desc) for func, name, desc in actions}

    def get_action_choices(self, request, default_choices=models.BLANK_CHOICE_DASH):
        choices = [] + default_choices
        for func, name, description in self.get_actions(request).values():
            choice = (name, description % model_format_dict(self.opts))
            choices.append(choice)
        return choices

    def get_action(self, action):
        
        if callable(action):
            func = action
            action = action.__name__

        
        
        
        elif hasattr(self.__class__, action):
            func = getattr(self.__class__, action)

        
        else:
            try:
                func = self.admin_site.get_action(action)
            except KeyError:
                return None

        description = self._get_action_description(func, action)
        return func, action, description

    def get_list_display(self, request):
        return self.list_display

    def get_list_display_links(self, request, list_display):
        if (
            self.list_display_links
            or self.list_display_links is None
            or not list_display
        ):
            return self.list_display_links
        else:
            
            return list(list_display)[:1]

    def get_list_filter(self, request):
        return self.list_filter

    def get_list_select_related(self, request):
        return self.list_select_related

    def get_search_fields(self, request):
        return self.search_fields

    def get_search_results(self, request, queryset, search_term):

        
        def construct_search(field_name):
            if field_name.startswith("^"):
                return "%s__istartswith" % field_name[1:]
            elif field_name.startswith("="):
                return "%s__iexact" % field_name[1:]
            elif field_name.startswith("@"):
                return "%s__search" % field_name[1:]
            
            opts = queryset.model._meta
            lookup_fields = field_name.split(LOOKUP_SEP)
            
            prev_field = None
            for path_part in lookup_fields:
                if path_part == "pk":
                    path_part = opts.pk.name
                try:
                    field = opts.get_field(path_part)
                except FieldDoesNotExist:
                    
                    if prev_field and prev_field.get_lookup(path_part):
                        return field_name
                else:
                    prev_field = field
                    if hasattr(field, "path_infos"):
                        
                        opts = field.path_infos[-1].to_opts
            
            return "%s__icontains" % field_name

        may_have_duplicates = False
        search_fields = self.get_search_fields(request)
        if search_fields and search_term:
            orm_lookups = [
                construct_search(str(search_field)) for search_field in search_fields
            ]
            term_queries = []
            for bit in smart_split(search_term):
                if bit.startswith(('"', "'")) and bit[0] == bit[-1]:
                    bit = unescape_string_literal(bit)
                or_queries = models.Q.create(
                    [(orm_lookup, bit) for orm_lookup in orm_lookups],
                    connector=models.Q.OR,
                )
                term_queries.append(or_queries)
            queryset = queryset.filter(models.Q.create(term_queries))
            may_have_duplicates |= any(
                lookup_spawns_duplicates(self.opts, search_spec)
                for search_spec in orm_lookups
            )
        return queryset, may_have_duplicates

    def get_preserved_filters(self, request):
        match = request.resolver_match
        if self.preserve_filters and match:
            current_url = "%s:%s" % (match.app_name, match.url_name)
            changelist_url = "admin:%s_%s_changelist" % (
                self.opts.app_label,
                self.opts.model_name,
            )
            if current_url == changelist_url:
                preserved_filters = request.GET.urlencode()
            else:
                preserved_filters = request.GET.get("_changelist_filters")

            if preserved_filters:
                return urlencode({"_changelist_filters": preserved_filters})
        return ""

    def construct_change_message(self, request, form, formsets, add=False):
        return construct_change_message(form, formsets, add)

    def message_user(
        self, request, message, level=messages.INFO, extra_tags="", fail_silently=False
    ):
        if not isinstance(level, int):
            
            try:
                level = getattr(messages.constants, level.upper())
            except AttributeError:
                levels = messages.constants.DEFAULT_TAGS.values()
                levels_repr = ", ".join("`%s`" % level for level in levels)
                raise ValueError(
                    "Bad message level string: `%s`. Possible values are: %s"
                    % (level, levels_repr)
                )

        messages.add_message(
            request, level, message, extra_tags=extra_tags, fail_silently=fail_silently
        )

    def save_form(self, request, form, change):
        return form.save(commit=False)

    def save_model(self, request, obj, form, change):
        obj.save()

    def delete_model(self, request, obj):
        obj.delete()

    def delete_queryset(self, request, queryset):
        queryset.delete()

    def save_formset(self, request, form, formset, change):
        formset.save()

    def save_related(self, request, form, formsets, change):
        form.save_m2m()
        for formset in formsets:
            self.save_formset(request, form, formset, change=change)

    def render_change_form(
        self, request, context, add=False, change=False, form_url="", obj=None
    ):
        app_label = self.opts.app_label
        preserved_filters = self.get_preserved_filters(request)
        form_url = add_preserved_filters(
            {"preserved_filters": preserved_filters, "opts": self.opts}, form_url
        )
        view_on_site_url = self.get_view_on_site_url(obj)
        has_editable_inline_admin_formsets = False
        for inline in context["inline_admin_formsets"]:
            if (
                inline.has_add_permission
                or inline.has_change_permission
                or inline.has_delete_permission
            ):
                has_editable_inline_admin_formsets = True
                break
        context.update(
            {
                "add": add,
                "change": change,
                "has_view_permission": self.has_view_permission(request, obj),
                "has_add_permission": self.has_add_permission(request),
                "has_change_permission": self.has_change_permission(request, obj),
                "has_delete_permission": self.has_delete_permission(request, obj),
                "has_editable_inline_admin_formsets": (
                    has_editable_inline_admin_formsets
                ),
                "has_file_field": context["adminform"].form.is_multipart()
                or any(
                    admin_formset.formset.is_multipart()
                    for admin_formset in context["inline_admin_formsets"]
                ),
                "has_absolute_url": view_on_site_url is not None,
                "absolute_url": view_on_site_url,
                "form_url": form_url,
                "opts": self.opts,
                "content_type_id": get_content_type_for_model(self.model).pk,
                "save_as": self.save_as,
                "save_on_top": self.save_on_top,
                "to_field_var": TO_FIELD_VAR,
                "is_popup_var": IS_POPUP_VAR,
                "app_label": app_label,
            }
        )
        if add and self.add_form_template is not None:
            form_template = self.add_form_template
        else:
            form_template = self.change_form_template

        request.current_app = self.admin_site.name

        return TemplateResponse(
            request,
            form_template
            or [
                "admin/%s/%s/change_form.html" % (app_label, self.opts.model_name),
                "admin/%s/change_form.html" % app_label,
                "admin/change_form.html",
            ],
            context,
        )

    def response_add(self, request, obj, post_url_continue=None):
        opts = obj._meta
        preserved_filters = self.get_preserved_filters(request)
        obj_url = reverse(
            "admin:%s_%s_change" % (opts.app_label, opts.model_name),
            args=(quote(obj.pk),),
            current_app=self.admin_site.name,
        )
        
        if self.has_change_permission(request, obj):
            obj_repr = format_html('<a href="{}">{}</a>', urlquote(obj_url), obj)
        else:
            obj_repr = str(obj)
        msg_dict = {
            "name": opts.verbose_name,
            "obj": obj_repr,
        }
        
        

        if IS_POPUP_VAR in request.POST:
            to_field = request.POST.get(TO_FIELD_VAR)
            if to_field:
                attr = str(to_field)
            else:
                attr = obj._meta.pk.attname
            value = obj.serializable_value(attr)
            popup_response_data = json.dumps(
                {
                    "value": str(value),
                    "obj": str(obj),
                }
            )
            return TemplateResponse(
                request,
                self.popup_response_template
                or [
                    "admin/%s/%s/popup_response.html"
                    % (opts.app_label, opts.model_name),
                    "admin/%s/popup_response.html" % opts.app_label,
                    "admin/popup_response.html",
                ],
                {
                    "popup_response_data": popup_response_data,
                },
            )

        elif "_continue" in request.POST or (
            
            "_saveasnew" in request.POST
            and self.save_as_continue
            and self.has_change_permission(request, obj)
        ):
            msg = _("The {name} “{obj}” was added successfully.")
            if self.has_change_permission(request, obj):
                msg += " " + _("You may edit it again below.")
            self.message_user(request, format_html(msg, **msg_dict), messages.SUCCESS)
            if post_url_continue is None:
                post_url_continue = obj_url
            post_url_continue = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": opts},
                post_url_continue,
            )
            return HttpResponseRedirect(post_url_continue)

        elif "_addanother" in request.POST:
            msg = format_html(
                _(
                    "The {name} “{obj}” was added successfully. You may add another "
                    "{name} below."
                ),
                **msg_dict,
            )
            self.message_user(request, msg, messages.SUCCESS)
            redirect_url = request.path
            redirect_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": opts}, redirect_url
            )
            return HttpResponseRedirect(redirect_url)

        else:
            msg = format_html(
                _("The {name} “{obj}” was added successfully."), **msg_dict
            )
            self.message_user(request, msg, messages.SUCCESS)
            return self.response_post_save_add(request, obj)

    def response_change(self, request, obj):

        if IS_POPUP_VAR in request.POST:
            opts = obj._meta
            to_field = request.POST.get(TO_FIELD_VAR)
            attr = str(to_field) if to_field else opts.pk.attname
            value = request.resolver_match.kwargs["object_id"]
            new_value = obj.serializable_value(attr)
            popup_response_data = json.dumps(
                {
                    "action": "change",
                    "value": str(value),
                    "obj": str(obj),
                    "new_value": str(new_value),
                }
            )
            return TemplateResponse(
                request,
                self.popup_response_template
                or [
                    "admin/%s/%s/popup_response.html"
                    % (opts.app_label, opts.model_name),
                    "admin/%s/popup_response.html" % opts.app_label,
                    "admin/popup_response.html",
                ],
                {
                    "popup_response_data": popup_response_data,
                },
            )

        opts = self.opts
        preserved_filters = self.get_preserved_filters(request)

        msg_dict = {
            "name": opts.verbose_name,
            "obj": format_html('<a href="{}">{}</a>', urlquote(request.path), obj),
        }
        if "_continue" in request.POST:
            msg = format_html(
                _(
                    "The {name} “{obj}” was changed successfully. You may edit it "
                    "again below."
                ),
                **msg_dict,
            )
            self.message_user(request, msg, messages.SUCCESS)
            redirect_url = request.path
            redirect_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": opts}, redirect_url
            )
            return HttpResponseRedirect(redirect_url)

        elif "_saveasnew" in request.POST:
            msg = format_html(
                _(
                    "The {name} “{obj}” was added successfully. You may edit it again "
                    "below."
                ),
                **msg_dict,
            )
            self.message_user(request, msg, messages.SUCCESS)
            redirect_url = reverse(
                "admin:%s_%s_change" % (opts.app_label, opts.model_name),
                args=(obj.pk,),
                current_app=self.admin_site.name,
            )
            redirect_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": opts}, redirect_url
            )
            return HttpResponseRedirect(redirect_url)

        elif "_addanother" in request.POST:
            msg = format_html(
                _(
                    "The {name} “{obj}” was changed successfully. You may add another "
                    "{name} below."
                ),
                **msg_dict,
            )
            self.message_user(request, msg, messages.SUCCESS)
            redirect_url = reverse(
                "admin:%s_%s_add" % (opts.app_label, opts.model_name),
                current_app=self.admin_site.name,
            )
            redirect_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": opts}, redirect_url
            )
            return HttpResponseRedirect(redirect_url)

        else:
            msg = format_html(
                _("The {name} “{obj}” was changed successfully."), **msg_dict
            )
            self.message_user(request, msg, messages.SUCCESS)
            return self.response_post_save_change(request, obj)

    def _response_post_save(self, request, obj):
        if self.has_view_or_change_permission(request):
            post_url = reverse(
                "admin:%s_%s_changelist" % (self.opts.app_label, self.opts.model_name),
                current_app=self.admin_site.name,
            )
            preserved_filters = self.get_preserved_filters(request)
            post_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": self.opts}, post_url
            )
        else:
            post_url = reverse("admin:index", current_app=self.admin_site.name)
        return HttpResponseRedirect(post_url)

    def response_post_save_add(self, request, obj):
        return self._response_post_save(request, obj)

    def response_post_save_change(self, request, obj):
        return self._response_post_save(request, obj)

    def response_action(self, request, queryset):

        
        
        
        try:
            action_index = int(request.POST.get("index", 0))
        except ValueError:
            action_index = 0

        
        data = request.POST.copy()
        data.pop(helpers.ACTION_CHECKBOX_NAME, None)
        data.pop("index", None)

        
        try:
            data.update({"action": data.getlist("action")[action_index]})
        except IndexError:
            
            
            
            pass

        action_form = self.action_form(data, auto_id=None)
        action_form.fields["action"].choices = self.get_action_choices(request)

        
        if action_form.is_valid():
            action = action_form.cleaned_data["action"]
            select_across = action_form.cleaned_data["select_across"]
            func = self.get_actions(request)[action][0]

            
            
            
            selected = request.POST.getlist(helpers.ACTION_CHECKBOX_NAME)
            if not selected and not select_across:
                
                msg = _(
                    "Items must be selected in order to perform "
                    "actions on them. No items have been changed."
                )
                self.message_user(request, msg, messages.WARNING)
                return None

            if not select_across:
                
                queryset = queryset.filter(pk__in=selected)

            response = func(self, request, queryset)

            
            
            
            if isinstance(response, HttpResponseBase):
                return response
            else:
                return HttpResponseRedirect(request.get_full_path())
        else:
            msg = _("No action selected.")
            self.message_user(request, msg, messages.WARNING)
            return None

    def response_delete(self, request, obj_display, obj_id):
        if IS_POPUP_VAR in request.POST:
            popup_response_data = json.dumps(
                {
                    "action": "delete",
                    "value": str(obj_id),
                }
            )
            return TemplateResponse(
                request,
                self.popup_response_template
                or [
                    "admin/%s/%s/popup_response.html"
                    % (self.opts.app_label, self.opts.model_name),
                    "admin/%s/popup_response.html" % self.opts.app_label,
                    "admin/popup_response.html",
                ],
                {
                    "popup_response_data": popup_response_data,
                },
            )

        self.message_user(
            request,
            _("The %(name)s “%(obj)s” was deleted successfully.")
            % {
                "name": self.opts.verbose_name,
                "obj": obj_display,
            },
            messages.SUCCESS,
        )

        if self.has_change_permission(request, None):
            post_url = reverse(
                "admin:%s_%s_changelist" % (self.opts.app_label, self.opts.model_name),
                current_app=self.admin_site.name,
            )
            preserved_filters = self.get_preserved_filters(request)
            post_url = add_preserved_filters(
                {"preserved_filters": preserved_filters, "opts": self.opts}, post_url
            )
        else:
            post_url = reverse("admin:index", current_app=self.admin_site.name)
        return HttpResponseRedirect(post_url)

    def render_delete_form(self, request, context):
        app_label = self.opts.app_label

        request.current_app = self.admin_site.name
        context.update(
            to_field_var=TO_FIELD_VAR,
            is_popup_var=IS_POPUP_VAR,
            media=self.media,
        )

        return TemplateResponse(
            request,
            self.delete_confirmation_template
            or [
                "admin/{}/{}/delete_confirmation.html".format(
                    app_label, self.opts.model_name
                ),
                "admin/{}/delete_confirmation.html".format(app_label),
                "admin/delete_confirmation.html",
            ],
            context,
        )

    def get_inline_formsets(self, request, formsets, inline_instances, obj=None):
        
        can_edit_parent = (
            self.has_change_permission(request, obj)
            if obj
            else self.has_add_permission(request)
        )
        inline_admin_formsets = []
        for inline, formset in zip(inline_instances, formsets):
            fieldsets = list(inline.get_fieldsets(request, obj))
            readonly = list(inline.get_readonly_fields(request, obj))
            if can_edit_parent:
                has_add_permission = inline.has_add_permission(request, obj)
                has_change_permission = inline.has_change_permission(request, obj)
                has_delete_permission = inline.has_delete_permission(request, obj)
            else:
                
                has_add_permission = (
                    has_change_permission
                ) = has_delete_permission = False
                formset.extra = formset.max_num = 0
            has_view_permission = inline.has_view_permission(request, obj)
            prepopulated = dict(inline.get_prepopulated_fields(request, obj))
            inline_admin_formset = helpers.InlineAdminFormSet(
                inline,
                formset,
                fieldsets,
                prepopulated,
                readonly,
                model_admin=self,
                has_add_permission=has_add_permission,
                has_change_permission=has_change_permission,
                has_delete_permission=has_delete_permission,
                has_view_permission=has_view_permission,
            )
            inline_admin_formsets.append(inline_admin_formset)
        return inline_admin_formsets

    def get_changeform_initial_data(self, request):
        initial = dict(request.GET.items())
        for k in initial:
            try:
                f = self.opts.get_field(k)
            except FieldDoesNotExist:
                continue
            
            if isinstance(f, models.ManyToManyField):
                initial[k] = initial[k].split(",")
        return initial

    def _get_obj_does_not_exist_redirect(self, request, opts, object_id):
        msg = _("%(name)s with ID “%(key)s” doesn’t exist. Perhaps it was deleted?") % {
            "name": opts.verbose_name,
            "key": unquote(object_id),
        }
        self.message_user(request, msg, messages.WARNING)
        url = reverse("admin:index", current_app=self.admin_site.name)
        return HttpResponseRedirect(url)

    @csrf_protect_m
    def changeform_view(self, request, object_id=None, form_url="", extra_context=None):
        with transaction.atomic(using=router.db_for_write(self.model)):
            return self._changeform_view(request, object_id, form_url, extra_context)

    def _changeform_view(self, request, object_id, form_url, extra_context):
        to_field = request.POST.get(TO_FIELD_VAR, request.GET.get(TO_FIELD_VAR))
        if to_field and not self.to_field_allowed(request, to_field):
            raise DisallowedModelAdminToField(
                "The field %s cannot be referenced." % to_field
            )

        if request.method == "POST" and "_saveasnew" in request.POST:
            object_id = None

        add = object_id is None

        if add:
            if not self.has_add_permission(request):
                raise PermissionDenied
            obj = None

        else:
            obj = self.get_object(request, unquote(object_id), to_field)

            if request.method == "POST":
                if not self.has_change_permission(request, obj):
                    raise PermissionDenied
            else:
                if not self.has_view_or_change_permission(request, obj):
                    raise PermissionDenied

            if obj is None:
                return self._get_obj_does_not_exist_redirect(
                    request, self.opts, object_id
                )

        fieldsets = self.get_fieldsets(request, obj)
        ModelForm = self.get_form(
            request, obj, change=not add, fields=flatten_fieldsets(fieldsets)
        )
        if request.method == "POST":
            form = ModelForm(request.POST, request.FILES, instance=obj)
            formsets, inline_instances = self._create_formsets(
                request,
                form.instance,
                change=not add,
            )
            form_validated = form.is_valid()
            if form_validated:
                new_object = self.save_form(request, form, change=not add)
            else:
                new_object = form.instance
            if all_valid(formsets) and form_validated:
                self.save_model(request, new_object, form, not add)
                self.save_related(request, form, formsets, not add)
                change_message = self.construct_change_message(
                    request, form, formsets, add
                )
                if add:
                    self.log_addition(request, new_object, change_message)
                    return self.response_add(request, new_object)
                else:
                    self.log_change(request, new_object, change_message)
                    return self.response_change(request, new_object)
            else:
                form_validated = False
        else:
            if add:
                initial = self.get_changeform_initial_data(request)
                form = ModelForm(initial=initial)
                formsets, inline_instances = self._create_formsets(
                    request, form.instance, change=False
                )
            else:
                form = ModelForm(instance=obj)
                formsets, inline_instances = self._create_formsets(
                    request, obj, change=True
                )

        if not add and not self.has_change_permission(request, obj):
            readonly_fields = flatten_fieldsets(fieldsets)
        else:
            readonly_fields = self.get_readonly_fields(request, obj)
        admin_form = helpers.AdminForm(
            form,
            list(fieldsets),
            
            self.get_prepopulated_fields(request, obj)
            if add or self.has_change_permission(request, obj)
            else {},
            readonly_fields,
            model_admin=self,
        )
        media = self.media + admin_form.media

        inline_formsets = self.get_inline_formsets(
            request, formsets, inline_instances, obj
        )
        for inline_formset in inline_formsets:
            media += inline_formset.media

        if add:
            title = _("Add %s")
        elif self.has_change_permission(request, obj):
            title = _("Change %s")
        else:
            title = _("View %s")
        context = {
            **self.admin_site.each_context(request),
            "title": title % self.opts.verbose_name,
            "subtitle": str(obj) if obj else None,
            "adminform": admin_form,
            "object_id": object_id,
            "original": obj,
            "is_popup": IS_POPUP_VAR in request.POST or IS_POPUP_VAR in request.GET,
            "to_field": to_field,
            "media": media,
            "inline_admin_formsets": inline_formsets,
            "errors": helpers.AdminErrorList(form, formsets),
            "preserved_filters": self.get_preserved_filters(request),
        }

        
        
        if (
            request.method == "POST"
            and not form_validated
            and "_saveasnew" in request.POST
        ):
            context["show_save"] = False
            context["show_save_and_continue"] = False
            
            add = False

        context.update(extra_context or {})

        return self.render_change_form(
            request, context, add=add, change=not add, obj=obj, form_url=form_url
        )

    def add_view(self, request, form_url="", extra_context=None):
        return self.changeform_view(request, None, form_url, extra_context)

    def change_view(self, request, object_id, form_url="", extra_context=None):
        return self.changeform_view(request, object_id, form_url, extra_context)

    def _get_edited_object_pks(self, request, prefix):
        pk_pattern = re.compile(
            r"{}-\d+-{}$".format(re.escape(prefix), self.opts.pk.name)
        )
        return [value for key, value in request.POST.items() if pk_pattern.match(key)]

    def _get_list_editable_queryset(self, request, prefix):
        object_pks = self._get_edited_object_pks(request, prefix)
        queryset = self.get_queryset(request)
        validate = queryset.model._meta.pk.to_python
        try:
            for pk in object_pks:
                validate(pk)
        except ValidationError:
            
            return queryset
        return queryset.filter(pk__in=object_pks)

    @csrf_protect_m
    def changelist_view(self, request, extra_context=None):
        from .views.main import ERROR_FLAG

        app_label = self.opts.app_label
        if not self.has_view_or_change_permission(request):
            raise PermissionDenied

        try:
            cl = self.get_changelist_instance(request)
        except IncorrectLookupParameters:
            
            
            
            
            
            
            if ERROR_FLAG in request.GET:
                return SimpleTemplateResponse(
                    "admin/invalid_setup.html",
                    {
                        "title": _("Database error"),
                    },
                )
            return HttpResponseRedirect(request.path + "?" + ERROR_FLAG + "=1")

        
        
        
        
        action_failed = False
        selected = request.POST.getlist(helpers.ACTION_CHECKBOX_NAME)

        actions = self.get_actions(request)
        
        if (
            actions
            and request.method == "POST"
            and "index" in request.POST
            and "_save" not in request.POST
        ):
            if selected:
                response = self.response_action(
                    request, queryset=cl.get_queryset(request)
                )
                if response:
                    return response
                else:
                    action_failed = True
            else:
                msg = _(
                    "Items must be selected in order to perform "
                    "actions on them. No items have been changed."
                )
                self.message_user(request, msg, messages.WARNING)
                action_failed = True

        
        if (
            actions
            and request.method == "POST"
            and helpers.ACTION_CHECKBOX_NAME in request.POST
            and "index" not in request.POST
            and "_save" not in request.POST
        ):
            if selected:
                response = self.response_action(
                    request, queryset=cl.get_queryset(request)
                )
                if response:
                    return response
                else:
                    action_failed = True

        if action_failed:
            
            
            
            return HttpResponseRedirect(request.get_full_path())

        
        
        
        formset = cl.formset = None

        
        if request.method == "POST" and cl.list_editable and "_save" in request.POST:
            if not self.has_change_permission(request):
                raise PermissionDenied
            FormSet = self.get_changelist_formset(request)
            modified_objects = self._get_list_editable_queryset(
                request, FormSet.get_default_prefix()
            )
            formset = cl.formset = FormSet(
                request.POST, request.FILES, queryset=modified_objects
            )
            if formset.is_valid():
                changecount = 0
                with transaction.atomic(using=router.db_for_write(self.model)):
                    for form in formset.forms:
                        if form.has_changed():
                            obj = self.save_form(request, form, change=True)
                            self.save_model(request, obj, form, change=True)
                            self.save_related(request, form, formsets=[], change=True)
                            change_msg = self.construct_change_message(
                                request, form, None
                            )
                            self.log_change(request, obj, change_msg)
                            changecount += 1
                if changecount:
                    msg = ngettext(
                        "%(count)s %(name)s was changed successfully.",
                        "%(count)s %(name)s were changed successfully.",
                        changecount,
                    ) % {
                        "count": changecount,
                        "name": model_ngettext(self.opts, changecount),
                    }
                    self.message_user(request, msg, messages.SUCCESS)

                return HttpResponseRedirect(request.get_full_path())

        
        elif cl.list_editable and self.has_change_permission(request):
            FormSet = self.get_changelist_formset(request)
            formset = cl.formset = FormSet(queryset=cl.result_list)

        
        if formset:
            media = self.media + formset.media
        else:
            media = self.media

        
        if actions:
            action_form = self.action_form(auto_id=None)
            action_form.fields["action"].choices = self.get_action_choices(request)
            media += action_form.media
        else:
            action_form = None

        selection_note_all = ngettext(
            "%(total_count)s selected", "All %(total_count)s selected", cl.result_count
        )

        context = {
            **self.admin_site.each_context(request),
            "module_name": str(self.opts.verbose_name_plural),
            "selection_note": _("0 of %(cnt)s selected") % {"cnt": len(cl.result_list)},
            "selection_note_all": selection_note_all % {"total_count": cl.result_count},
            "title": cl.title,
            "subtitle": None,
            "is_popup": cl.is_popup,
            "to_field": cl.to_field,
            "cl": cl,
            "media": media,
            "has_add_permission": self.has_add_permission(request),
            "opts": cl.opts,
            "action_form": action_form,
            "actions_on_top": self.actions_on_top,
            "actions_on_bottom": self.actions_on_bottom,
            "actions_selection_counter": self.actions_selection_counter,
            "preserved_filters": self.get_preserved_filters(request),
            **(extra_context or {}),
        }

        request.current_app = self.admin_site.name

        return TemplateResponse(
            request,
            self.change_list_template
            or [
                "admin/%s/%s/change_list.html" % (app_label, self.opts.model_name),
                "admin/%s/change_list.html" % app_label,
                "admin/change_list.html",
            ],
            context,
        )

    def get_deleted_objects(self, objs, request):
        return get_deleted_objects(objs, request, self.admin_site)

    @csrf_protect_m
    def delete_view(self, request, object_id, extra_context=None):
        with transaction.atomic(using=router.db_for_write(self.model)):
            return self._delete_view(request, object_id, extra_context)

    def _delete_view(self, request, object_id, extra_context):
        app_label = self.opts.app_label

        to_field = request.POST.get(TO_FIELD_VAR, request.GET.get(TO_FIELD_VAR))
        if to_field and not self.to_field_allowed(request, to_field):
            raise DisallowedModelAdminToField(
                "The field %s cannot be referenced." % to_field
            )

        obj = self.get_object(request, unquote(object_id), to_field)

        if not self.has_delete_permission(request, obj):
            raise PermissionDenied

        if obj is None:
            return self._get_obj_does_not_exist_redirect(request, self.opts, object_id)

        
        
        (
            deleted_objects,
            model_count,
            perms_needed,
            protected,
        ) = self.get_deleted_objects([obj], request)

        if request.POST and not protected:  
            if perms_needed:
                raise PermissionDenied
            obj_display = str(obj)
            attr = str(to_field) if to_field else self.opts.pk.attname
            obj_id = obj.serializable_value(attr)
            self.log_deletion(request, obj, obj_display)
            self.delete_model(request, obj)

            return self.response_delete(request, obj_display, obj_id)

        object_name = str(self.opts.verbose_name)

        if perms_needed or protected:
            title = _("Cannot delete %(name)s") % {"name": object_name}
        else:
            title = _("Are you sure?")

        context = {
            **self.admin_site.each_context(request),
            "title": title,
            "subtitle": None,
            "object_name": object_name,
            "object": obj,
            "deleted_objects": deleted_objects,
            "model_count": dict(model_count).items(),
            "perms_lacking": perms_needed,
            "protected": protected,
            "opts": self.opts,
            "app_label": app_label,
            "preserved_filters": self.get_preserved_filters(request),
            "is_popup": IS_POPUP_VAR in request.POST or IS_POPUP_VAR in request.GET,
            "to_field": to_field,
            **(extra_context or {}),
        }

        return self.render_delete_form(request, context)

    def history_view(self, request, object_id, extra_context=None):
        from .models import LogEntry
        from .views.main import PAGE_VAR

        
        model = self.model
        obj = self.get_object(request, unquote(object_id))
        if obj is None:
            return self._get_obj_does_not_exist_redirect(
                request, model._meta, object_id
            )

        if not self.has_view_or_change_permission(request, obj):
            raise PermissionDenied

        
        app_label = self.opts.app_label
        action_list = (
            LogEntry.objects.filter(
                object_id=unquote(object_id),
                content_type=get_content_type_for_model(model),
            )
            .select_related()
            .order_by("action_time")
        )

        paginator = self.get_paginator(request, action_list, 100)
        page_number = request.GET.get(PAGE_VAR, 1)
        page_obj = paginator.get_page(page_number)
        page_range = paginator.get_elided_page_range(page_obj.number)

        context = {
            **self.admin_site.each_context(request),
            "title": _("Change history: %s") % obj,
            "subtitle": None,
            "action_list": page_obj,
            "page_range": page_range,
            "page_var": PAGE_VAR,
            "pagination_required": paginator.count > 100,
            "module_name": str(capfirst(self.opts.verbose_name_plural)),
            "object": obj,
            "opts": self.opts,
            "preserved_filters": self.get_preserved_filters(request),
            **(extra_context or {}),
        }

        request.current_app = self.admin_site.name

        return TemplateResponse(
            request,
            self.object_history_template
            or [
                "admin/%s/%s/object_history.html" % (app_label, self.opts.model_name),
                "admin/%s/object_history.html" % app_label,
                "admin/object_history.html",
            ],
            context,
        )

    def get_formset_kwargs(self, request, obj, inline, prefix):
        formset_params = {
            "instance": obj,
            "prefix": prefix,
            "queryset": inline.get_queryset(request),
        }
        if request.method == "POST":
            formset_params.update(
                {
                    "data": request.POST.copy(),
                    "files": request.FILES,
                    "save_as_new": "_saveasnew" in request.POST,
                }
            )
        return formset_params

    def _create_formsets(self, request, obj, change):
        formsets = []
        inline_instances = []
        prefixes = {}
        get_formsets_args = [request]
        if change:
            get_formsets_args.append(obj)
        for FormSet, inline in self.get_formsets_with_inlines(*get_formsets_args):
            prefix = FormSet.get_default_prefix()
            prefixes[prefix] = prefixes.get(prefix, 0) + 1
            if prefixes[prefix] != 1 or not prefix:
                prefix = "%s-%s" % (prefix, prefixes[prefix])
            formset_params = self.get_formset_kwargs(request, obj, inline, prefix)
            formset = FormSet(**formset_params)

            def user_deleted_form(request, obj, formset, index, inline):
                return (
                    inline.has_delete_permission(request, obj)
                    and "{}-{}-DELETE".format(formset.prefix, index) in request.POST
                )

            
            
            if not inline.has_change_permission(request, obj if change else None):
                for index, form in enumerate(formset.initial_forms):
                    if user_deleted_form(request, obj, formset, index, inline):
                        continue
                    form._errors = {}
                    form.cleaned_data = form.initial
            formsets.append(formset)
            inline_instances.append(inline)
        return formsets, inline_instances


class InlineModelAdmin(BaseModelAdmin):

    model = None
    fk_name = None
    formset = BaseInlineFormSet
    extra = 3
    min_num = None
    max_num = None
    template = None
    verbose_name = None
    verbose_name_plural = None
    can_delete = True
    show_change_link = False
    checks_class = InlineModelAdminChecks
    classes = None

    def __init__(self, parent_model, admin_site):
        self.admin_site = admin_site
        self.parent_model = parent_model
        self.opts = self.model._meta
        self.has_registered_model = admin_site.is_registered(self.model)
        super().__init__()
        if self.verbose_name_plural is None:
            if self.verbose_name is None:
                self.verbose_name_plural = self.opts.verbose_name_plural
            else:
                self.verbose_name_plural = format_lazy("{}s", self.verbose_name)
        if self.verbose_name is None:
            self.verbose_name = self.opts.verbose_name

    @property
    def media(self):
        extra = "" if settings.DEBUG else ".min"
        js = ["vendor/jquery/jquery%s.js" % extra, "jquery.init.js", "inlines.js"]
        if self.filter_vertical or self.filter_horizontal:
            js.extend(["SelectBox.js", "SelectFilter2.js"])
        if self.classes and "collapse" in self.classes:
            js.append("collapse.js")
        return forms.Media(js=["admin/js/%s" % url for url in js])

    def get_extra(self, request, obj=None, **kwargs):
        return self.extra

    def get_min_num(self, request, obj=None, **kwargs):
        return self.min_num

    def get_max_num(self, request, obj=None, **kwargs):
        return self.max_num

    def get_formset(self, request, obj=None, **kwargs):
        if "fields" in kwargs:
            fields = kwargs.pop("fields")
        else:
            fields = flatten_fieldsets(self.get_fieldsets(request, obj))
        excluded = self.get_exclude(request, obj)
        exclude = [] if excluded is None else list(excluded)
        exclude.extend(self.get_readonly_fields(request, obj))
        if excluded is None and hasattr(self.form, "_meta") and self.form._meta.exclude:
            
            
            exclude.extend(self.form._meta.exclude)
        
        
        exclude = exclude or None
        can_delete = self.can_delete and self.has_delete_permission(request, obj)
        defaults = {
            "form": self.form,
            "formset": self.formset,
            "fk_name": self.fk_name,
            "fields": fields,
            "exclude": exclude,
            "formfield_callback": partial(self.formfield_for_dbfield, request=request),
            "extra": self.get_extra(request, obj, **kwargs),
            "min_num": self.get_min_num(request, obj, **kwargs),
            "max_num": self.get_max_num(request, obj, **kwargs),
            "can_delete": can_delete,
            **kwargs,
        }

        base_model_form = defaults["form"]
        can_change = self.has_change_permission(request, obj) if request else True
        can_add = self.has_add_permission(request, obj) if request else True

        class DeleteProtectedModelForm(base_model_form):
            def hand_clean_DELETE(self):
                if self.cleaned_data.get(DELETION_FIELD_NAME, False):
                    using = router.db_for_write(self._meta.model)
                    collector = NestedObjects(using=using)
                    if self.instance._state.adding:
                        return
                    collector.collect([self.instance])
                    if collector.protected:
                        objs = []
                        for p in collector.protected:
                            objs.append(
                                
                                
                                
                                _("%(class_name)s %(instance)s")
                                % {"class_name": p._meta.verbose_name, "instance": p}
                            )
                        params = {
                            "class_name": self._meta.model._meta.verbose_name,
                            "instance": self.instance,
                            "related_objects": get_text_list(objs, _("and")),
                        }
                        msg = _(
                            "Deleting %(class_name)s %(instance)s would require "
                            "deleting the following protected related objects: "
                            "%(related_objects)s"
                        )
                        raise ValidationError(
                            msg, code="deleting_protected", params=params
                        )

            def is_valid(self):
                result = super().is_valid()
                self.hand_clean_DELETE()
                return result

            def has_changed(self):
                
                if not can_change and not self.instance._state.adding:
                    return False
                if not can_add and self.instance._state.adding:
                    return False
                return super().has_changed()

        defaults["form"] = DeleteProtectedModelForm

        if defaults["fields"] is None and not modelform_defines_fields(
            defaults["form"]
        ):
            defaults["fields"] = forms.ALL_FIELDS

        return inlineformset_factory(self.parent_model, self.model, **defaults)

    def _get_form_for_get_fields(self, request, obj=None):
        return self.get_formset(request, obj, fields=None).form

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if not self.has_view_or_change_permission(request):
            queryset = queryset.none()
        return queryset

    def _has_any_perms_for_target_model(self, request, perms):
        opts = self.opts
        
        for field in opts.fields:
            if field.remote_field and field.remote_field.model != self.parent_model:
                opts = field.remote_field.model._meta
                break
        return any(
            request.user.has_perm(
                "%s.%s" % (opts.app_label, get_permission_codename(perm, opts))
            )
            for perm in perms
        )

    def has_add_permission(self, request, obj):
        if self.opts.auto_created:
            
            
            
            
            return self._has_any_perms_for_target_model(request, ["change"])
        return super().has_add_permission(request)

    def has_change_permission(self, request, obj=None):
        if self.opts.auto_created:
            
            return self._has_any_perms_for_target_model(request, ["change"])
        return super().has_change_permission(request)

    def has_delete_permission(self, request, obj=None):
        if self.opts.auto_created:
            
            return self._has_any_perms_for_target_model(request, ["change"])
        return super().has_delete_permission(request, obj)

    def has_view_permission(self, request, obj=None):
        if self.opts.auto_created:
            
            
            return self._has_any_perms_for_target_model(request, ["view", "change"])
        return super().has_view_permission(request)


class StackedInline(InlineModelAdmin):
    template = "admin/edit_inline/stacked.html"


class TabularInline(InlineModelAdmin):
    template = "admin/edit_inline/tabular.html"
