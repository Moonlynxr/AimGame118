"""
main.py  —  AIM GAME 118  v3.1
──────────────────────────────────────────────────────
Arrancar:
    uvicorn main:app --reload --port 8000

Docs interactivas:
    http://127.0.0.1:8000/docs
"""

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from passlib.context import CryptContext
from mysql.connector import Error as MySQLError

from database import get_connection
from schemas import (
    RegisterRequest,    RegisterResponse,
    LoginRequest,       LoginResponse,
    SubmitScoreRequest, SubmitScoreResponse,
    LeaderboardResponse, LeaderboardEntry,
    HistorialResponse,   HistorialEntry,
)

# ── App ────────────────────────────────────────────
app = FastAPI(
    title="AIM GAME 118 — API",
    version="3.1.0",
    description="Backend para el Aim Trainer 2.5D escolar.",
)

# ── CORS ───────────────────────────────────────────
# Permite que el frontend (HTML local o servidor) llame al backend.
# En producción cambia allow_origins por tu dominio real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # ← cambiar en producción
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Hashing de contraseñas (bcrypt) ────────────────
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ══════════════════════════════════════════════════
#  HEALTH CHECK  —  GET /
# ══════════════════════════════════════════════════
@app.get("/", tags=["estado"])
def raiz():
    """Verifica que el servidor esté corriendo."""
    return {"ok": True, "mensaje": "AIM GAME 118 API v3.1 funcionando ✓"}


# ══════════════════════════════════════════════════
#  REGISTRO  —  POST /register
# ══════════════════════════════════════════════════
@app.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["usuarios"],
    summary="Registrar nuevo jugador",
)
def register(body: RegisterRequest):
    """
    Crea un nuevo usuario en la tabla `usuarios`.

    - Valida que email y username no estén en uso.
    - Guarda la contraseña con hash bcrypt (nunca en texto plano).
    """
    pass_hash = pwd_ctx.hash(body.password)

    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)

            # Verificar duplicados antes de insertar
            cursor.execute(
                "SELECT id, email, username FROM usuarios "
                "WHERE email = %s OR username = %s LIMIT 1",
                (body.email, body.username),
            )
            existente = cursor.fetchone()

            if existente:
                campo = "email" if existente["email"] == body.email else "nombre de usuario"
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"El {campo} ya está en uso.",
                )

            # Insertar usuario
            cursor.execute(
                "INSERT INTO usuarios (username, email, pass_hash) VALUES (%s, %s, %s)",
                (body.username, body.email, pass_hash),
            )
            conn.commit()
            nuevo_id = cursor.lastrowid

    except HTTPException:
        raise
    except MySQLError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos: {e}",
        )

    return RegisterResponse(
        ok=True,
        usuario_id=nuevo_id,
        username=body.username,
        mensaje="Usuario registrado correctamente.",
    )


# ══════════════════════════════════════════════════
#  LOGIN  —  POST /login
# ══════════════════════════════════════════════════
@app.post(
    "/login",
    response_model=LoginResponse,
    tags=["usuarios"],
    summary="Iniciar sesión",
)
def login(body: LoginRequest):
    """
    Verifica credenciales y devuelve datos del usuario.

    - Busca por email.
    - Compara contraseña contra el hash con bcrypt.
    - Actualiza `ultimo_login`.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)

            cursor.execute(
                "SELECT id, username, pass_hash, activo "
                "FROM usuarios WHERE email = %s LIMIT 1",
                (body.email,),
            )
            usuario = cursor.fetchone()

            # Misma respuesta para email inexistente o contraseña incorrecta
            # (no revelar cuál falla exactamente)
            credenciales_invalidas = HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Correo o contraseña incorrectos.",
            )

            if not usuario:
                raise credenciales_invalidas

            if not usuario["activo"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cuenta desactivada.",
                )

            if not pwd_ctx.verify(body.password, usuario["pass_hash"]):
                raise credenciales_invalidas

            # Actualizar ultimo_login
            cursor.execute(
                "UPDATE usuarios SET ultimo_login = NOW() WHERE id = %s",
                (usuario["id"],),
            )
            conn.commit()

    except HTTPException:
        raise
    except MySQLError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos: {e}",
        )

    return LoginResponse(
        ok=True,
        usuario_id=usuario["id"],
        username=usuario["username"],
        mensaje=f"Bienvenido, {usuario['username']}.",
    )


# ══════════════════════════════════════════════════
#  GUARDAR PARTIDA  —  POST /submit-score
# ══════════════════════════════════════════════════
@app.post(
    "/submit-score",
    response_model=SubmitScoreResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["partidas"],
    summary="Guardar resultado de una partida",
)
def submit_score(body: SubmitScoreRequest):
    """
    Inserta una partida en la tabla `partidas`.

    El trigger `after_partida_insert` actualiza automáticamente
    `mejores_scores` si el nuevo score supera el récord del usuario.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)

            # Verificar que el usuario existe y está activo
            cursor.execute(
                "SELECT id FROM usuarios WHERE id = %s AND activo = 1 LIMIT 1",
                (body.usuario_id,),
            )
            if not cursor.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Usuario no encontrado.",
                )

            # Insertar partida — el trigger hace el resto
            cursor.execute(
                """
                INSERT INTO partidas
                    (usuario_id, score_raw, score_final,
                     precision_pct, aciertos, disparos)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    body.usuario_id,
                    body.score_raw,
                    body.score_final,
                    round(body.precision_pct, 2),
                    body.aciertos,
                    body.disparos,
                ),
            )
            conn.commit()
            partida_id = cursor.lastrowid

    except HTTPException:
        raise
    except MySQLError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos: {e}",
        )

    return SubmitScoreResponse(
        ok=True,
        partida_id=partida_id,
        mensaje="Partida guardada correctamente.",
    )


# ══════════════════════════════════════════════════
#  LEADERBOARD  —  GET /leaderboard
# ══════════════════════════════════════════════════
@app.get(
    "/leaderboard",
    response_model=LeaderboardResponse,
    tags=["leaderboard"],
    summary="Top 10 global",
)
def leaderboard():
    """
    Devuelve el top 10 global desde la vista `v_leaderboard_global`.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute("SELECT * FROM v_leaderboard_global")
            filas = cursor.fetchall()

    except MySQLError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos: {e}",
        )

    ranking = [LeaderboardEntry(**f) for f in filas]
    return LeaderboardResponse(ok=True, total=len(ranking), ranking=ranking)


# ══════════════════════════════════════════════════
#  HISTORIAL  —  GET /historial/{usuario_id}
# ══════════════════════════════════════════════════
@app.get(
    "/historial/{usuario_id}",
    response_model=HistorialResponse,
    tags=["partidas"],
    summary="Historial de partidas de un usuario",
)
def historial(usuario_id: int):
    """
    Devuelve todas las partidas del usuario ordenadas por fecha,
    con su rank personal. Usa la vista `v_historial_usuario`.
    """
    try:
        with get_connection() as conn:
            cursor = conn.cursor(dictionary=True)

            cursor.execute(
                "SELECT id, username FROM usuarios "
                "WHERE id = %s AND activo = 1 LIMIT 1",
                (usuario_id,),
            )
            usuario = cursor.fetchone()
            if not usuario:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Usuario no encontrado.",
                )

            cursor.execute(
                """
                SELECT *
                FROM v_historial_usuario
                WHERE username = %s
                ORDER BY jugado_en DESC
                """,
                (usuario["username"],),
            )
            filas = cursor.fetchall()

    except HTTPException:
        raise
    except MySQLError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de base de datos: {e}",
        )

    partidas = [HistorialEntry(**f) for f in filas]
    return HistorialResponse(
        ok=True,
        usuario_id=usuario_id,
        username=usuario["username"],
        total=len(partidas),
        partidas=partidas,
    )
