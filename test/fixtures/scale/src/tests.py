from contextlib import contextmanager

from django.contrib.staticfiles.testing import StaticLiveServerTestCase
from django.test import modify_settings
from django.test.selenium import SeleniumTestCase
from django.utils.deprecation import MiddlewareMixin
from django.utils.translation import gettext as _


class CSPMiddleware(MiddlewareMixin):

    def process_response(self, request, response):
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        return response


@modify_settings(MIDDLEWARE={"append": "django.contrib.admin.tests.CSPMiddleware"})
class AdminSeleniumTestCase(SeleniumTestCase, StaticLiveServerTestCase):
    available_apps = [
        "django.contrib.admin",
        "django.contrib.auth",
        "django.contrib.contenttypes",
        "django.contrib.sessions",
        "django.contrib.sites",
    ]

    def wait_until(self, callback, timeout=10):
        from selenium.webdriver.support.wait import WebDriverWait

        WebDriverWait(self.selenium, timeout).until(callback)

    def wait_for_and_switch_to_popup(self, num_windows=2, timeout=10):
        self.wait_until(lambda d: len(d.window_handles) == num_windows, timeout)
        self.selenium.switch_to.window(self.selenium.window_handles[-1])
        self.wait_page_ready()

    def wait_for(self, css_selector, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        self.wait_until(
            ec.presence_of_element_located((By.CSS_SELECTOR, css_selector)), timeout
        )

    def wait_for_text(self, css_selector, text, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        self.wait_until(
            ec.text_to_be_present_in_element((By.CSS_SELECTOR, css_selector), text),
            timeout,
        )

    def wait_for_value(self, css_selector, text, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        self.wait_until(
            ec.text_to_be_present_in_element_value(
                (By.CSS_SELECTOR, css_selector), text
            ),
            timeout,
        )

    def wait_until_visible(self, css_selector, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        self.wait_until(
            ec.visibility_of_element_located((By.CSS_SELECTOR, css_selector)), timeout
        )

    def wait_until_invisible(self, css_selector, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        self.wait_until(
            ec.invisibility_of_element_located((By.CSS_SELECTOR, css_selector)), timeout
        )

    def wait_page_ready(self, timeout=10):
        self.wait_until(
            lambda driver: driver.execute_script("return document.readyState;")
            == "complete",
            timeout,
        )

    @contextmanager
    def wait_page_loaded(self, timeout=10):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as ec

        old_page = self.selenium.find_element(By.TAG_NAME, "html")
        yield
        
        self.wait_until(ec.staleness_of(old_page), timeout=timeout)
        self.wait_page_ready(timeout=timeout)

    def admin_login(self, username, password, login_url="/admin/"):
        from selenium.webdriver.common.by import By

        self.selenium.get("%s%s" % (self.live_server_url, login_url))
        username_input = self.selenium.find_element(By.NAME, "username")
        username_input.send_keys(username)
        password_input = self.selenium.find_element(By.NAME, "password")
        password_input.send_keys(password)
        login_text = _("Log in")
        with self.wait_page_loaded():
            self.selenium.find_element(
                By.XPATH, '//input[@value="%s"]' % login_text
            ).click()

    def select_option(self, selector, value):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import Select

        select = Select(self.selenium.find_element(By.CSS_SELECTOR, selector))
        select.select_by_value(value)

    def deselect_option(self, selector, value):
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import Select

        select = Select(self.selenium.find_element(By.CSS_SELECTOR, selector))
        select.deselect_by_value(value)

    def assertCountSeleniumElements(self, selector, count, root_element=None):
        from selenium.webdriver.common.by import By

        root_element = root_element or self.selenium
        self.assertEqual(
            len(root_element.find_elements(By.CSS_SELECTOR, selector)), count
        )

    def _assertOptionsValues(self, options_selector, values):
        from selenium.webdriver.common.by import By

        if values:
            options = self.selenium.find_elements(By.CSS_SELECTOR, options_selector)
            actual_values = []
            for option in options:
                actual_values.append(option.get_attribute("value"))
            self.assertEqual(values, actual_values)
        else:
            
            
            
            with self.disable_implicit_wait():
                self.wait_until(
                    lambda driver: not driver.find_elements(
                        By.CSS_SELECTOR, options_selector
                    )
                )

    def assertSelectOptions(self, selector, values):
        self._assertOptionsValues("%s > option" % selector, values)

    def assertSelectedOptions(self, selector, values):
        self._assertOptionsValues("%s > option:checked" % selector, values)

    def has_css_class(self, selector, klass):
        from selenium.webdriver.common.by import By

        return (
            self.selenium.find_element(
                By.CSS_SELECTOR,
                selector,
            )
            .get_attribute("class")
            .find(klass)
            != -1
        )
