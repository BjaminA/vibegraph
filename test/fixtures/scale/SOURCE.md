# Upstream provenance

This directory holds the scale-benchmark fixture for M6.

- **Repo:** [django/django](https://github.com/django/django)
- **Pin:** `879e5d587b84e6fc961829611999431778eb9f6a` (tag 4.2)
- **Subdir:** `django/contrib/admin/`
- **License:** BSD-3 (see `LICENSE.upstream`)

Files were fetched at the pinned commit and run through `scripts/synth_scale_fixture.py`, which uses libcst to strip module/function/class docstrings and all comments. Names are NOT mangled -- the parser doesn't care about identifier semantics, so PLAN.md's deterministic name-mangling pass is deferred. The deterministic input -> output property holds via the libcst transform alone.

**Vendored size**: 29 files, 335650 -> 279361 bytes (16.8% reduction from doc/comment strip).

## File inventory

- `src/__init__.py` -- 1169 -> 1089 bytes -- `sha256:9983b47370f0b79a...`
- `src/actions.py` -- 3257 -> 2490 bytes -- `sha256:9a8d057f63b1c959...`
- `src/apps.py` -- 840 -> 686 bytes -- `sha256:dcef870da86678e6...`
- `src/checks.py` -- 49782 -> 44256 bytes -- `sha256:7dcf070ddcf698df...`
- `src/decorators.py` -- 3481 -> 1864 bytes -- `sha256:5dc21d308021435c...`
- `src/exceptions.py` -- 333 -> 190 bytes -- `sha256:0bd9cb683a4d68c9...`
- `src/filters.py` -- 20891 -> 18629 bytes -- `sha256:739b70ea22a59795...`
- `src/forms.py` -- 1023 -> 951 bytes -- `sha256:76b7639679762be4...`
- `src/helpers.py` -- 18190 -> 17239 bytes -- `sha256:a4f96cf8c27a4149...`
- `src/migrations/0001_initial.py` -- 2507 -> 2507 bytes -- `sha256:f4716989d9815b62...`
- `src/migrations/0002_logentry_remove_auto_add.py` -- 553 -> 487 bytes -- `sha256:274b5d091e07c437...`
- `src/migrations/0003_logentry_add_action_flag_choices.py` -- 538 -> 487 bytes -- `sha256:1cacaf389810ff5e...`
- `src/migrations/__init__.py` -- 0 -> 0 bytes -- `sha256:e3b0c44298fc1c14...`
- `src/models.py` -- 6501 -> 6018 bytes -- `sha256:476acfdc75b998e4...`
- `src/options.py` -- 98119 -> 78498 bytes -- `sha256:d48a7bcdb4b85b3f...`
- `src/sites.py` -- 22473 -> 16491 bytes -- `sha256:7da1ce13edbdeb40...`
- `src/templatetags/__init__.py` -- 0 -> 0 bytes -- `sha256:e3b0c44298fc1c14...`
- `src/templatetags/admin_list.py` -- 18492 -> 16469 bytes -- `sha256:1871d463af188c3a...`
- `src/templatetags/admin_modify.py` -- 4978 -> 4556 bytes -- `sha256:29ec60ef9b1ee043...`
- `src/templatetags/admin_urls.py` -- 1926 -> 1866 bytes -- `sha256:2a167ecf013f2ec4...`
- `src/templatetags/base.py` -- 1474 -> 1281 bytes -- `sha256:ebb729173a97db2d...`
- `src/templatetags/log.py` -- 2167 -> 1594 bytes -- `sha256:52606cf0ce828463...`
- `src/tests.py` -- 8524 -> 6245 bytes -- `sha256:140b1b4430a1e5f0...`
- `src/utils.py` -- 20469 -> 15917 bytes -- `sha256:9cc646b50d59c8ff...`
- `src/views/__init__.py` -- 0 -> 0 bytes -- `sha256:e3b0c44298fc1c14...`
- `src/views/autocomplete.py` -- 4316 -> 3232 bytes -- `sha256:ccd4b41914251112...`
- `src/views/decorators.py` -- 639 -> 489 bytes -- `sha256:1a91c37b6b2d9c72...`
- `src/views/main.py` -- 23813 -> 18892 bytes -- `sha256:fa55fde3f1f8a992...`
- `src/widgets.py` -- 19195 -> 16938 bytes -- `sha256:a868bf85541fd505...`

## Regenerate

```
python3 scripts/synth_scale_fixture.py            # vendor
python3 scripts/synth_scale_fixture.py --check    # verify
```

Bumping the pin is an intentional fixture refresh; do it when you want a fresh shape, not to chase upstream churn.
