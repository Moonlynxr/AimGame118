# AIM GAME 118 — Backend

## Instalación paso a paso

### 1. Instalar dependencias necesarias (solo una vez)

Abre la terminal integrada de VSCode (`Ctrl + ñ`) dentro de la carpeta `backend/` y ejecuta:

```bash
pip install -r requirements.txt
```

Eso instala FastAPI, uvicorn, mysql-connector, passlib y pydantic.

---

### 2. Configurar la conexión a MySQL

Crea un archivo `.env` dentro de `backend/` copiando `.env.example`:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=tu_password_de_mysql
DB_NAME=aimgame118
```

> **Nunca subas `.env` a GitHub.** Agrega `.env` a tu `.gitignore`.

---

### 3. Arrancar el servidor

```bash
uvicorn main:app --reload --port 8000
```

- `--reload` reinicia automáticamente al guardar cambios (ideal para desarrollo).
- El servidor queda en `http://127.0.0.1:8000`

---

### 4. Documentación automática

FastAPI genera una interfaz visual para probar todos los endpoints:

```
http://127.0.0.1:8000/docs
```

---

## Estructura del proyecto

```
backend/
├── main.py          ← endpoints y lógica de negocio
├── database.py      ← pool de conexiones MySQL
├── schemas.py       ← modelos Pydantic (validación de datos)
├── requirements.txt ← dependencias
├── .env.example     ← plantilla de configuración
└── .env             ← tu configuración real (NO subir a git)
```

---

## Endpoints disponibles

| Método | Ruta                    | Descripción                    |
|--------|-------------------------|--------------------------------|
| GET    | `/`                     | Health check                   |
| POST   | `/register`             | Registrar nuevo jugador        |
| POST   | `/login`                | Iniciar sesión                 |
| POST   | `/submit-score`         | Guardar resultado de partida   |
| GET    | `/leaderboard`          | Top 10 global                  |
| GET    | `/historial/{usuario_id}` | Historial personal           |

---

## Ejemplos de fetch() desde el frontend (game.js)

### Registrar usuario

```js
async function registrarUsuario(username, email, password) {
    const res = await fetch('http://127.0.0.1:8000/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
        console.error('Error:', data.detail);
        return null;
    }
    // data.usuario_id  ← guardar en localStorage para usarlo en submit-score
    localStorage.setItem('usuario_id', data.usuario_id);
    localStorage.setItem('username',   data.username);
    return data;
}
```

### Iniciar sesión

```js
async function iniciarSesion(email, password) {
    const res = await fetch('http://127.0.0.1:8000/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok) {
        console.error('Error:', data.detail);
        return null;
    }
    localStorage.setItem('usuario_id', data.usuario_id);
    localStorage.setItem('username',   data.username);
    return data;
}
```

### Guardar partida (llamar desde endGame() en game.js)

```js
async function guardarPartida({ scoreRaw, scoreFinal, precisionPct, aciertos, disparos }) {
    const usuarioId = localStorage.getItem('usuario_id');
    if (!usuarioId) return;   // no hay sesión activa

    const res = await fetch('http://127.0.0.1:8000/submit-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            usuario_id:    parseInt(usuarioId),
            score_raw:     scoreRaw,
            score_final:   scoreFinal,
            precision_pct: precisionPct,
            aciertos:      aciertos,
            disparos:      disparos
        })
    });
    const data = await res.json();
    if (!res.ok) console.error('Error al guardar partida:', data.detail);
    return data;
}
```

### Obtener leaderboard global

```js
async function cargarLeaderboard() {
    const res  = await fetch('http://127.0.0.1:8000/leaderboard');
    const data = await res.json();
    // data.ranking  ← array con los top 10
    return data.ranking;
}
```

### Historial de un usuario

```js
async function cargarHistorial() {
    const usuarioId = localStorage.getItem('usuario_id');
    if (!usuarioId) return [];

    const res  = await fetch(`http://127.0.0.1:8000/historial/${usuarioId}`);
    const data = await res.json();
    // data.partidas  ← array de partidas ordenadas por fecha
    return data.partidas;
}
```

---

## Notas para escalar a producción

- Agregar **JWT tokens** en login para sesiones seguras (librería: `python-jose`).
- Cambiar `allow_origins=["*"]` en CORS por el dominio real del frontend.
- Usar un servidor de producción como **Gunicorn** en lugar de uvicorn `--reload`.
- Mover las credenciales de `.env` a variables de entorno del servidor.
