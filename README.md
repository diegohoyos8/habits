# Habitos

Un rastreador de hábitos personal, inspirado en *Cuatro mil semanas* de Oliver Burkeman.
Da estructura sin convertir la vida en una lista de pendientes infinita.

**Página publicada:** https://claude.ai/artifact/3M3fXU3rajQ6G8TKFW9gkN
(privada; los datos se guardan con tu cuenta de claude.ai y solo tú los ves).

## La idea

- **Volumen fijo.** Máximo tres cosas importantes al día. Si entra algo nuevo, algo sale.
- **Cada día empieza en limpio.** Lo que no hiciste no se acumula como deuda; si sigue importando, lo traes a propósito.
- **Elegir en qué quedarse corto.** Cada semana anotas qué dejas ir a propósito.
- **Lista de lo hecho.** El día se cierra con lo que sí hiciste.
- **Tendencia, no rachas.** Una semana sin registro queda en blanco, no en cero. Lo que se mide es el equilibrio entre áreas a lo largo de las semanas.
- **Ocio elegido.** No se prohíbe. Cada vez se anota el tipo (película, serie, videojuego, otro o los que agregues), la duración real y qué fue, bajo un límite de 10 h por semana y sin culpa.

## Cómo está organizada

Los hábitos se agrupan en cinco **frentes**. Cada uno tiene anclas diarias, ritmos semanales (sin día fijo, con meta de veces por semana) y su propio porcentaje semanal.

| Frente | Qué incluye |
|---|---|
| **Salud** | Meditar, moverme, comer bien (diario); horas de sueño; salir a la naturaleza (1×); ocio elegido con límite de 10 h por semana. |
| **Social** | Jugar con Emilia (diario); llamar a mis papás y mandar fotos de Emilia (2×); escribir a un amigo lejos (2×); compartir con amigos cerca (1×). |
| **Finanzas** | Trabajo profundo (5×); revisar finanzas personales (1×); actualizar CV y LinkedIn (1×); fechas clave del mes (pagos, cobros y tareas como los cierres de Kakebo). |
| **Desarrollo** | Leer con foco (diario); proyecto creativo (2×); aprender: cursos de IA (2×); construir mis apps de Claude (2×). |
| **Hogar** | Limpieza en días fijos (aspirar, trapear y WC los lunes y jueves); hacer la compra (1×). |

Aparte quedan **Pendientes varios** (una lista sencilla, sin fecha) y la revisión mensual de finanzas en *Mes*.

Todo se puede ajustar en **Ajustes**: activar o pausar, renombrar, cambiar metas y añadir hábitos nuevos.

### Secciones

- **Hoy**: el día. La tira de los 7 días para moverte, lo importante de la semana como recordatorio, la agenda de Google Calendar, las tres prioridades del día, los cinco frentes (en Salud: el entrenamiento del día, el sueño y la actividad de la Fitbit, y el ocio), pendientes varios y lo hecho.
- **Semana**: lo que se planea y revisa por semana. Lo importante de la semana y lo que dejas ir, el plan de entrenamiento día por día, el balance por frente, la cuadrícula de la semana, el cierre del domingo y, de jueves a domingo, lo importante de la próxima semana.
- **Mes**: calendario con pagos, cobros y tareas, y la revisión de finanzas.
- **Objetivos**: máximo 3 activos. Tipos: peso (leído de Google Health, con avance, ritmo de las últimas 4 semanas y fecha estimada), número (por ejemplo, libros leídos) e hito (se cumple o no).
- **Tendencia**: el año en semanas, la línea de balance de las últimas 12 semanas y el mapa por frente.
- **Ajustes**: fechas de nacimiento, metas de sueño y ocio, plan de entrenamiento por día, tipos de ocio, anclas, ritmos y hogar.

### Entrenamiento

Tres planes base, editables día por día en Ajustes: **Equilibrado** (6 días: pesas de empuje, tirón y pierna, 2 de cardio y 1 de yoga), **Poco tiempo** (4 días cortos) y **Bajar de peso** (6 días con más cardio). Cada sesión trae su rutina (series y repeticiones, o minutos). En Hoy puedes cambiar la sesión del día. Si la Fitbit registra 15 minutos o más de ejercicio un día con sesión, se marca sola; lo que marcas a mano manda.

## Cómo empezar (sugerencia)

1. **Hoy (domingo):** abre la página, ve a *Ajustes* y pon tu fecha de nacimiento y la de Emilia. En *Mes*, añade las fechas de pago y cobro (renta, créditos, tarjetas). Es lo único que conviene hacer de una vez.
2. **Ritual del domingo (10 min):** en *Semana*, elige hasta tres cosas importantes para la semana y una que dejas ir.
3. **Semana 1–2:** solo usa *Hoy*. Por la mañana, las tres cosas; durante el día, toca lo que vayas haciendo. No completes nada a la fuerza.
4. **Al final de la semana 2:** mira *Tendencia* y ajusta las metas. Si algo nunca entra, pausa ese ritmo: también es una elección.

## Detalles técnicos

- Un solo archivo HTML (`habitos.html`), sin dependencias más allá de dos fuentes de Google Fonts.
- Se publica como Artifact de claude.ai con las capacidades `db`, `user` y `mcp` (Google Calendar y Fit Bit). Los datos viven en `data/users/<tu id>/`, privado por persona:
  - `config`: anclas, ritmos, fechas clave y metas.
  - `w-AAAA-MM-DD`: un documento por semana (clave = lunes), con los días, los ritmos, el plan y el cierre.
  - `m-AAAA-MM`: un documento por mes con pagos y cobros marcados y la revisión de finanzas.
  - `todo`: la lista de pendientes varios.
- La agenda usa la capacidad `mcp` con el conector **Google Calendar**, solo con la herramienta de lectura `list_events`. La página nunca crea ni modifica eventos. La primera vez, claude.ai pide permiso para que la página lea el calendario; se puede revocar desde el menú Permisos de la página.
- El sueño y el movimiento llegan de la Fitbit Air a través del conector **Fit Bit** (carpeta `conector-fitbit/`, publicado en `https://mi-fitbit.vercel.app`), con la herramienta de lectura `resumen_de_dias`. La página lee la semana que estás viendo y:
  - llena "Dormí anoche" con las horas dormidas (con hora de acostarte y despertar);
  - marca "Moverme" si hubo un ejercicio de 10 minutos o más, o 20 minutos en zona activa;
  - muestra pasos, ejercicios y pulso en reposo en el frente Salud.

  Lo que corriges a mano manda: la pulsera no lo vuelve a cambiar. Un enlace permite volver al dato de la Fitbit.
- Abierta fuera de claude.ai, la página funciona en modo de vista previa (sin guardar, sin agenda y sin Fitbit).
