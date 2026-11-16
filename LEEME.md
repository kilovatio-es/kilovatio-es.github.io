# Kilovatio · cómo publicarla con precios que se actualizan solos

La web lee los precios de `data/energia.json`. Ese archivo lo crea y actualiza **GitHub Actions**
(un servicio gratuito de GitHub que ejecuta un programa a horas fijas) con el script `scripts/update_data.py`:

- PVPC hora a hora de hoy y de mañana, de Red Eléctrica (con el archivo público de e·sios como alternativa).
- Histórico de 400 días → medias del mes, del mes pasado, de los últimos 30 días y por periodos.
- Precio medio nacional de la gasolina 95 y del gasóleo, del Ministerio (todas las gasolineras de España).

Se ejecuta 4 veces al día (hacia las 00:10, 07:30, 20:40 y 21:40, hora de España).

## Por qué GitHub Pages y no Netlify

En el plan gratuito de Netlify cada publicación gasta 15 de los 300 créditos del mes: unas 20 publicaciones al mes.
Si se acaban, Netlify **pausa todas tus webs** (también HD Autocollector). Con precios diarios se gastarían en una semana.
GitHub Pages es gratuito y no tiene ese límite.

## Pasos (unos 15 minutos)

1. Crea una cuenta en **github.com**.
2. Pulsa **New repository**. Nombre: `kilovatio`. Márcalo como **Public**. Pulsa **Create repository**.
3. En el repositorio, pulsa **uploading an existing file** y arrastra **todos los archivos y carpetas** de este .zip
   (los .html, `style.css`, `common.js`, `robots.txt` y la carpeta `scripts`). Pulsa **Commit changes**.
4. El archivo del robot va en una carpeta oculta y conviene crearlo a mano:
   **Add file → Create new file**, escribe como nombre `.github/workflows/actualizar-datos.yml`
   y pega el contenido del archivo `actualizar-datos.yml` de este .zip. Pulsa **Commit changes**.
5. **Settings → Actions → General → Workflow permissions** → marca **Read and write permissions** → **Save**.
6. Pestaña **Actions** → **Actualizar precios de la energía** → **Run workflow**. En 1–2 minutos aparece `data/energia.json`.
7. **Settings → Pages** → Source: **Deploy from a branch** → Branch: **main** y **/ (root)** → **Save**.
   En un par de minutos la web estará en `https://TU-USUARIO.github.io/kilovatio/`.
8. Más adelante puedes conectar tu dominio propio en **Settings → Pages → Custom domain**.

## Qué se actualiza solo y qué no

| Dato | Actualización |
|---|---|
| PVPC por horas (hoy y mañana) | Automática, cada día |
| Medias del mes, del mes pasado y de 30 días | Automática |
| Precios por defecto de las calculadoras | Automática (usan las medias reales) |
| Gasolina y gasóleo | Automática, cada día |
| Término de potencia, impuestos, TUR del gas, deducciones | Manual: cambian por resolución oficial (BOE), normalmente cada trimestre o cada año |
