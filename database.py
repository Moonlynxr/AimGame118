"""
database.py
─────────────────────────────────────────────────────
Gestiona el pool de conexiones a MySQL.

Usamos mysql-connector-python con pooling para no abrir
una conexión nueva en cada request; el pool reutiliza
conexiones ya existentes (más eficiente y escalable).
"""

import os
import mysql.connector
from mysql.connector import pooling, Error as MySQLError
from dotenv import load_dotenv

# Carga las variables del archivo .env
load_dotenv()

# ── Configuración leída desde .env ─────────────────
_DB_CONFIG = {
    "host":     os.getenv("DB_HOST",     "localhost"),
    "port":     int(os.getenv("DB_PORT", "3306")),
    "user":     os.getenv("DB_USER",     "root"),
    "password": os.getenv("DB_PASSWORD"),   # ← sin valor por defecto, viene del .env
    "database": os.getenv("DB_NAME",     "aimgame118"),
}

# ── Pool de conexiones (máximo 5 simultáneas) ───────
#    Aumenta pool_size si esperas más usuarios concurrentes.
_pool: pooling.MySQLConnectionPool | None = None


def _get_pool() -> pooling.MySQLConnectionPool:
    """Crea el pool la primera vez; lo devuelve si ya existe."""
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="aimgame_pool",
            pool_size=5,
            pool_reset_session=True,
            **_DB_CONFIG,
        )
    return _pool


def get_connection() -> mysql.connector.MySQLConnection:
    """
    Devuelve una conexión del pool.
    Úsala siempre con 'with' para garantizar que se libere:

        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            ...
    """
    try:
        return _get_pool().get_connection()
    except MySQLError as e:
        raise ConnectionError(f"No se pudo conectar a MySQL: {e}") from e