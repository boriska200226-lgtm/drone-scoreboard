"""Схемы запросов и ответов."""
from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    login: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    totp: str | None = Field(default=None, max_length=8)


class LoginOut(BaseModel):
    token: str
    role: Literal["teacher", "student"]
    login: str
    class_id: int
    class_name: str
    hero_id: int | None = None
    nickname: str | None = None


class CreateClassIn(BaseModel):
    school_code: str = Field(min_length=1, max_length=32)
    class_name: str = Field(min_length=1, max_length=16)
    teacher_password: str = Field(min_length=8, max_length=128)
    nickname_style: Literal["totem", "element", "craft"] = "totem"
    class_target: int = Field(default=100, ge=10, le=10000)


class GenerateStudentsIn(BaseModel):
    count: int = Field(default=25, ge=1, le=40)
    # Настоящие имена не обязательны: без них Реестр остаётся пустым,
    # и связь «кличка → ученик» учитель держит вне системы.
    real_names: list[str] = Field(default_factory=list, max_length=40)


class GeneratedCredential(BaseModel):
    login: str
    password: str
    nickname: str
    branch: str


class AwardIn(BaseModel):
    hero_id: int
    action: str
    note: str = Field(default="", max_length=200)


class AttendanceItem(BaseModel):
    hero_id: int
    status: Literal["present", "absent", "excused"]
    lesson: int = Field(default=1, ge=1, le=10)


class AttendanceIn(BaseModel):
    day: date | None = None
    items: list[AttendanceItem] = Field(min_length=1, max_length=200)


class MatIn(BaseModel):
    hero_id: int | None = None
    note: str = Field(default="", max_length=200)


class WhistleIn(BaseModel):
    blasts: Literal[1, 2] = 1


class ResetPasswordIn(BaseModel):
    login: str


class QuietMailIn(BaseModel):
    sticker: Literal["angry", "scared", "change"]


class VoteIn(BaseModel):
    topic: Literal["nickname_style", "tea_menu"]
    option: str = Field(min_length=1, max_length=64)


class AvatarIn(BaseModel):
    avatar: str = Field(max_length=8)
