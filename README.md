# Nuestras Finanzas

App para llevar los gastos y aportes en pareja: gastos individuales, gastos pagados
desde una cuenta común, y aportes a esa cuenta común, con balance de "quién puso más".

Los datos viven en una base **Neon (Postgres)** y se sincronizan entre los dos
celulares vía una función de Netlify (así la contraseña de la base nunca queda
expuesta en el navegador).

## 1. Crear la base en Neon

1. Andá a https://neon.tech, creá una cuenta gratis y un proyecto nuevo.
2. En el editor SQL del proyecto, ejecutá:

   ```sql
   create table app_state (
     id text primary key,
     data jsonb not null,
     updated_at timestamptz default now()
   );
   ```

3. Andá a **Connection Details** / **Connection string** y copiá la cadena que
   empieza con `postgresql://...`. La vas a necesitar en el paso 3.

## 2. Subir el proyecto a GitHub

Desde la carpeta del proyecto:

```bash
git init
git add .
git commit -m "Primera versión de Nuestras Finanzas"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/finanzas-pareja.git
git push -u origin main
```

(Creá antes el repositorio vacío en GitHub, sin README, para que el push no choque.)

## 3. Conectar con Netlify

1. En https://app.netlify.com → **Add new site → Import an existing project**.
2. Elegí GitHub y el repositorio `finanzas-pareja`.
3. Build command: `npm run build` — Publish directory: `dist` (ya viene en `netlify.toml`, así que Netlify lo detecta solo).
4. Antes de dar deploy, andá a **Site configuration → Environment variables** y agregá:
   - `DATABASE_URL` = la cadena de conexión de Neon del paso 1.
5. Deploy site.

## 4. Probarla

Abrí la URL que te da Netlify desde tu celu y desde el de tu mujer. Cualquier
gasto o aporte que cargue uno va a aparecer en el otro celular en unos
segundos (sincroniza cada 4s).

## Desarrollo local (opcional)

Para probar en tu compu antes de subir:

```bash
npm install
npm install -g netlify-cli   # una sola vez
netlify dev
```

`netlify dev` levanta el sitio y las funciones juntos. Vas a necesitar un
archivo `.env` local con `DATABASE_URL=...` (ver `.env.example`) para que la
función pueda conectarse a Neon mientras probás en tu máquina.

## Nota sobre seguridad

Esta app no tiene login: cualquiera que tenga el link puede ver y editar los
datos. Para una pareja compartiendo el link solo entre ustedes dos está bien,
pero no la compartas públicamente ni la indexen buscadores.
