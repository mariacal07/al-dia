# Al día

Tu agenda de rutinas y cosas no urgentes: skincare, limpieza, plantas… Cada día te enseña lo que te toca, y tiene métricas para ver qué llevas bien y qué se te escapa.

- **Hoy**: lo que toca hoy, agrupado por categorías. Puedes moverte por la semana.
- **Tareas**: tus tareas y categorías (con su color e icono). El botón **+** añade una tarea.
- **Pendientes**: lista de cosas sin fecha que siempre pospones ("ordenar el armario"). Se apuntan en un segundo, se pueden etiquetar por esfuerzo (⚡ rápida, ⏱️ un rato, 💪 grande) y el botón **🎲 Elige una por mí** te propone una al azar. Al hacerla eliges la fecha. En **Hoy** aparece una sugerencia diaria de esta lista.
- **Métricas**: % de cumplimiento, rachas, mapa de constancia, evolución por semanas, por categoría, por día de la semana, lo que necesita atención, la frecuencia real de cada tarea y, de los pendientes, cuántos haces, cuánto tardas de media y si la lista crece o mengua.

Marcar una tarea como hecha es **opcional**: lo que toca cada día no depende de eso. Solo sirve para alimentar las métricas.

Todo es **gratis**: el alojamiento es GitHub Pages y la base de datos es Supabase (plan gratuito).

---

## Puesta en marcha (una sola vez, unos 20 minutos)

### 1. Base de datos en Supabase

1. Entra en <https://supabase.com> y crea una cuenta gratuita.
2. Pulsa **New project**. Ponle un nombre (por ejemplo `al-dia`), una contraseña para la base de datos (guárdala, aunque no la vas a necesitar en la app) y elige la región **Europe**.
3. Cuando el proyecto esté listo, ve a **SQL Editor** (menú de la izquierda) → **New query**.
4. Abre el archivo [`supabase/schema.sql`](supabase/schema.sql), copia todo el contenido, pégalo y pulsa **Run**. Tiene que salir "Success".
5. Ve a **Project Settings → API** y copia dos cosas:
   - **Project URL** (algo como `https://abcdxyz.supabase.co`)
   - la clave **anon public**
6. Abre [`js/config.js`](js/config.js) y pega los dos valores entre las comillas.

> La clave "anon" no es secreta: está pensada para ir dentro de la web. Lo que protege tus datos es que solo tú puedes iniciar sesión con tu cuenta, y la base de datos solo te deja ver lo tuyo.

### 2. Configurar el inicio de sesión

En Supabase, ve a **Authentication → Sign In / Providers → Email**:

- Desactiva **Confirm email**. Así no tienes que confirmar el correo al crear tu cuenta.

### 3. Publicar la web en GitHub Pages

1. Crea una cuenta gratuita en <https://github.com>.
2. Crea un repositorio nuevo (por ejemplo `al-dia`). Puede ser **público**: tus datos no están en el código, están en Supabase.
3. Sube todos los archivos de esta carpeta, salvo `.claude/`. Puedes arrastrarlos en "Add file → Upload files".
4. En el repositorio, ve a **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`** y pulsa Save.
5. En un minuto tendrás la app en `https://TU-USUARIO.github.io/al-dia/`.

### 4. Crear tu cuenta y cerrar el registro

1. Abre esa dirección, pulsa **"¿Primera vez? Crea tu cuenta"** y regístrate con tu email y una contraseña.
2. Vuelve a Supabase → **Authentication → Sign In / Providers** y desactiva **Allow new users to sign up**. Así nadie más puede crearse una cuenta en tu app.

### 5. Instalarla en el móvil

- **iPhone (Safari)**: abre la dirección → botón Compartir → **Añadir a pantalla de inicio**.
- **Android (Chrome)**: abre la dirección → menú ⋮ → **Instalar aplicación** (o "Añadir a pantalla de inicio").

Se abre a pantalla completa, como una app normal. En el ordenador entras con la misma dirección y los mismos datos.

---

## Probarla en el ordenador

Sin rellenar `js/config.js`, la app arranca en **modo demo**, con datos de ejemplo guardados solo en el navegador. Para abrirla en local:

```bash
python -m http.server 5173
```

y abre <http://localhost:5173>.

## Copias de seguridad

En **Tareas → Descargar copia de seguridad** se descarga un archivo con todos tus datos. Supabase ya los guarda en la nube; esto es por si quieres tener una copia tuya.

## Nota sobre el plan gratuito de Supabase

Si un proyecto gratuito pasa **7 días sin ningún uso**, Supabase lo pone en pausa. No se borra nada: entras en supabase.com y le das a "Restore". Si abres la app de vez en cuando, no te va a pasar.
