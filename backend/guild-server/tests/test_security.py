"""Пароли, шифрование Реестра и второй фактор."""
import time

import pytest
from cryptography.fernet import Fernet

from app import security


class TestPasswords:
    def test_length_and_alphabet(self):
        pwd = security.gen_password()
        assert len(pwd) == 12
        assert set(pwd) <= set(security.PASSWORD_ALPHABET)

    def test_confusable_glyphs_excluded(self):
        assert not set("0O1lI") & set(security.PASSWORD_ALPHABET)

    def test_passwords_differ(self):
        assert len({security.gen_password() for _ in range(50)}) == 50

    def test_bcrypt_roundtrip(self, monkeypatch):
        monkeypatch.setenv("BCRYPT_ROUNDS", "4")
        security.get_settings.cache_clear()
        h = security.hash_password("Correct-Horse-12")
        assert h.startswith("$2b$")
        assert security.verify_password("Correct-Horse-12", h)
        assert not security.verify_password("wrong", h)
        security.get_settings.cache_clear()

    def test_verify_survives_garbage_hash(self):
        assert security.verify_password("x", "not-a-hash") is False


class TestRegistryCipher:
    def test_roundtrip(self):
        cipher = security.RegistryCipher(Fernet.generate_key().decode())
        blob = cipher.encrypt("Иванов Пётр")
        assert "Иванов".encode() not in blob
        assert cipher.decrypt(blob) == "Иванов Пётр"

    def test_other_key_cannot_read(self):
        blob = security.RegistryCipher(Fernet.generate_key().decode()).encrypt("Сидорова Аня")
        with pytest.raises(RuntimeError):
            security.RegistryCipher(Fernet.generate_key().decode()).decrypt(blob)

    def test_missing_key_fails_loudly(self, monkeypatch):
        monkeypatch.setenv("REGISTRY_KEY", "")
        security.get_settings.cache_clear()
        with pytest.raises(RuntimeError):
            security.RegistryCipher()
        security.get_settings.cache_clear()


class TestTotp:
    def test_code_shape(self):
        secret = security.gen_totp_secret()
        code = security.totp_at(secret)
        assert len(code) == 6 and code.isdigit()

    def test_verifies_current_code(self):
        secret = security.gen_totp_secret()
        assert security.verify_totp(secret, security.totp_at(secret))

    def test_accepts_one_step_drift(self):
        secret = security.gen_totp_secret()
        past = security.totp_at(secret, time.time() - security.TOTP_STEP)
        assert security.verify_totp(secret, past)

    def test_rejects_old_code(self):
        secret = security.gen_totp_secret()
        stale = security.totp_at(secret, time.time() - security.TOTP_STEP * 10)
        assert not security.verify_totp(secret, stale)

    def test_rejects_garbage(self):
        secret = security.gen_totp_secret()
        assert not security.verify_totp(secret, "abcdef")
        assert not security.verify_totp(secret, "")

    def test_uri_carries_secret(self):
        secret = security.gen_totp_secret()
        assert secret in security.totp_uri(secret, "t_42_7b")
