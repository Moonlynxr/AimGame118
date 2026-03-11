"""
schemas.py
─────────────────────────────────────────────────────
Modelos Pydantic: definen qué datos acepta y devuelve
cada endpoint.  FastAPI los usa para validar automáticamente
y generar la documentación en /docs.
"""

from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import datetime
from typing import Optional


# ══════════════════════════════════════════════════
#  USUARIOS
# ══════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    """Body de POST /register"""
    username: str = Field(
        min_length=3,
        max_length=30,
        pattern=r"^[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+$",   # sin espacios ni símbolos raros
        examples=["sniper_gx"],
    )
    email: EmailStr                                  # valida formato correo
    password: str = Field(
        min_length=8,
        max_length=72,                               # bcrypt trunca a 72 chars
        examples=["MiPass1234!"],
    )

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        """Mínimo: una mayúscula, una minúscula y un dígito."""
        if not any(c.isupper() for c in v):
            raise ValueError("La contraseña debe tener al menos una mayúscula.")
        if not any(c.islower() for c in v):
            raise ValueError("La contraseña debe tener al menos una minúscula.")
        if not any(c.isdigit() for c in v):
            raise ValueError("La contraseña debe tener al menos un número.")
        return v


class RegisterResponse(BaseModel):
    """Respuesta exitosa de POST /register"""
    ok:         bool
    usuario_id: int
    username:   str
    mensaje:    str


class LoginRequest(BaseModel):
    """Body de POST /login"""
    email:    EmailStr
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    """Respuesta exitosa de POST /login"""
    ok:         bool
    usuario_id: int
    username:   str
    mensaje:    str


# ══════════════════════════════════════════════════
#  PARTIDAS
# ══════════════════════════════════════════════════

class SubmitScoreRequest(BaseModel):
    """Body de POST /submit-score"""
    usuario_id:   int          = Field(gt=0)
    score_raw:    int          = Field(ge=0)
    score_final:  int          = Field(ge=0)
    precision_pct: float       = Field(ge=0.0, le=100.0)
    aciertos:     int          = Field(ge=0)
    disparos:     int          = Field(ge=0)

    @field_validator("disparos")
    @classmethod
    def disparos_gte_aciertos(cls, v: int, info) -> int:
        aciertos = info.data.get("aciertos", 0)
        if v < aciertos:
            raise ValueError("Los disparos no pueden ser menores que los aciertos.")
        return v


class SubmitScoreResponse(BaseModel):
    """Respuesta de POST /submit-score"""
    ok:         bool
    partida_id: int
    mensaje:    str


# ══════════════════════════════════════════════════
#  LEADERBOARD
# ══════════════════════════════════════════════════

class LeaderboardEntry(BaseModel):
    """Una fila del leaderboard global"""
    posicion:      int
    username:      str
    score_final:   int
    score_raw:     int
    precision_pct: float
    aciertos:      int
    disparos:      int
    fecha_mejor:   datetime


class LeaderboardResponse(BaseModel):
    ok:      bool
    total:   int
    ranking: list[LeaderboardEntry]


# ══════════════════════════════════════════════════
#  HISTORIAL
# ══════════════════════════════════════════════════

class HistorialEntry(BaseModel):
    """Una partida en el historial personal"""
    partida_id:    int
    score_final:   int
    score_raw:     int
    precision_pct: float
    aciertos:      int
    disparos:      int
    jugado_en:     datetime
    rank_personal: int       # posición dentro de las partidas del usuario


class HistorialResponse(BaseModel):
    ok:         bool
    usuario_id: int
    username:   str
    total:      int
    partidas:   list[HistorialEntry]


# ══════════════════════════════════════════════════
#  ERRORES genéricos
# ══════════════════════════════════════════════════

class ErrorResponse(BaseModel):
    ok:      bool  = False
    detalle: str
