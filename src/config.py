import re
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

# Instance-download JDBC JAR (often named ServiceNow-JDBC-*.jar) — not the Simba URL shape
# from Configure JDBC driver; native URLs use jdbc:servicenow://https://<host> + JDBC props.
NATIVE_SN_JDBC_DRIVER = "com.snc.db.jdbc.JDBCDriver"
_NATIVE_JDBC_PREFIX_RE = re.compile(r"jdbc:servicenow://", re.IGNORECASE)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    sn_instance: str = Field(alias="SN_INSTANCE")
    sn_username: str = Field(alias="SN_USERNAME")
    sn_password: SecretStr = Field(alias="SN_PASSWORD")
    sn_jdbc_jar_path: str = Field(alias="SN_JDBC_JAR_PATH")
    sn_jdbc_driver_class: str = Field(
        default="com.simba.servicenow.jdbc.Driver",
        alias="SN_JDBC_DRIVER_CLASS",
    )
    sn_jdbc_url: str | None = Field(default=None, alias="SN_JDBC_URL")

    api_key: SecretStr | None = Field(default=None, alias="API_KEY")
    # When true, do not serve the bundled web UI at "/". All REST endpoints
    # keep working — useful for production / headless deployments behind a
    # gateway where only the API surface should be exposed.
    api_only: bool = Field(default=False, alias="API_ONLY")

    @property
    def normalized_instance(self) -> str:
        value = self.sn_instance.strip()
        value = value.replace("https://", "").replace("http://", "")
        value = value.strip("/")
        if "." not in value:
            return f"{value}.service-now.com"
        return value

    @staticmethod
    def _normalize_native_jdbc_url(url: str) -> str:
        """Native driver expects authority https://<host> after jdbc:servicenow://."""
        m = _NATIVE_JDBC_PREFIX_RE.match(url)
        if not m:
            return url
        rest = url[m.end() :]
        lower = rest.lower()
        if lower.startswith("https://") or lower.startswith("http://"):
            return url
        return f"{m.group(0)}https://{rest}"

    @property
    def jdbc_url(self) -> str:
        if self.sn_jdbc_url:
            return self._normalize_native_jdbc_url(self.sn_jdbc_url)

        if self.sn_jdbc_driver_class == NATIVE_SN_JDBC_DRIVER:
            return f"jdbc:servicenow://https://{self.normalized_instance}"

        # Official Simba format (semicolon-separated properties):
        # https://www.servicenow.com/docs/r/api-reference/web-services/configure-jdbc-driver.html
        return (
            "jdbc:servicenow:"
            f"Server=https://{self.normalized_instance};"
            f"User={self.sn_username};"
            f"Password={self.sn_password.get_secret_value()};"
        )

    @staticmethod
    def _redact_jdbc_url(url: str) -> str:
        return re.sub(
            r"(Password=)[^;]*",
            r"\1***",
            url,
            flags=re.IGNORECASE,
        )

    @property
    def jdbc_driver_args(self) -> dict[str, str] | None:
        if self.sn_jdbc_driver_class == NATIVE_SN_JDBC_DRIVER:
            return {
                "user": self.sn_username,
                "password": self.sn_password.get_secret_value(),
                "User": self.sn_username,
                "Password": self.sn_password.get_secret_value(),
            }
        # Official doc: User and Password live in the JDBC URL, not separate connect args.
        return None

    @property
    def jdbc_auth_debug(self) -> dict[str, object]:
        args = self.jdbc_driver_args
        auth_mode = "jdbc_properties" if isinstance(args, dict) else "url_properties"
        return {
            "driver_class": self.sn_jdbc_driver_class,
            "jdbc_url_redacted": self._redact_jdbc_url(self.jdbc_url),
            "auth_mode": auth_mode,
            "username": self.sn_username,
            "password_length": len(self.sn_password.get_secret_value()),
            "sn_jdbc_url_set": bool(self.sn_jdbc_url),
        }


settings = Settings()
