# Semanas contadas

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
- **Ocio elegido.** No se prohíbe; se le da un presupuesto semanal y se registra sin culpa.

## Cómo está organizada

| Ritmo | Qué incluye |
|---|---|
| **Anclas diarias** | Meditar, mirar la agenda, moverme, comer bien, leer con foco, jugar con Emilia. Además: horas de sueño y minutos de ocio. |
| **Ritmos semanales** (sin día fijo, con meta de veces por semana) | Trabajo profundo (5), revisar finanzas (1), llamar a mis papás y mandar fotos de Emilia (2), escribir a un amigo lejos (2), amigos cerca (1), naturaleza (1), proyecto creativo (2), perfil profesional (CV, LinkedIn, cursos de IA) (2), apps de Claude (2), limpiar la casa (2), hacer la compra (1). |
| **Mensual** | Fechas clave que se repiten cada mes (pagos y cobros de renta, créditos, tarjetas) y una revisión mensual de finanzas. |

Todo se puede ajustar en **Ajustes**: activar o pausar, renombrar, cambiar metas y añadir hábitos nuevos.

### Secciones

- **Hoy**: la agenda del día desde Google Calendar, las tres prioridades, las anclas, sueño y ocio, los ritmos de la semana, fechas próximas, lo hecho y una línea para recordar.
- **Semana**: lo importante de la semana, lo que dejas ir, la cuadrícula de los siete días y el cierre del domingo.
- **Mes**: calendario con pagos y cobros, y la revisión de finanzas.
- **Tendencia**: el año en semanas, la línea de balance de las últimas 12 semanas y el mapa por área.
- **Ajustes**: fechas de nacimiento (tuya y de Emilia), metas de sueño y ocio, anclas y ritmos.

## Cómo empezar (sugerencia)

1. **Hoy (domingo):** abre la página, ve a *Ajustes* y pon tu fecha de nacimiento y la de Emilia. En *Mes*, añade las fechas de pago y cobro (renta, créditos, tarjetas). Es lo único que conviene hacer de una vez.
2. **Ritual del domingo (10 min):** en *Semana*, elige hasta tres cosas importantes para la semana y una que dejas ir.
3. **Semana 1–2:** solo usa *Hoy*. Por la mañana, las tres cosas; durante el día, toca lo que vayas haciendo. No completes nada a la fuerza.
4. **Al final de la semana 2:** mira *Tendencia* y ajusta las metas. Si algo nunca entra, pausa ese ritmo: también es una elección.

## Detalles técnicos

- Un solo archivo HTML (`semanas-contadas.html`), sin dependencias más allá de dos fuentes de Google Fonts.
- Se publica como Artifact de claude.ai con las capacidades `db`, `user` y `mcp`. Los datos viven en `data/users/<tu id>/`, privado por persona:
  - `config`: anclas, ritmos, fechas clave y metas.
  - `w-AAAA-MM-DD`: un documento por semana (clave = lunes), con los días, los ritmos, el plan y el cierre.
  - `m-AAAA-MM`: un documento por mes con pagos y cobros marcados y la revisión de finanzas.
- La agenda usa la capacidad `mcp` con el conector **Google Calendar**, solo con la herramienta de lectura `list_events`. La página nunca crea ni modifica eventos. La primera vez, claude.ai pide permiso para que la página lea el calendario; se puede revocar desde el menú Permisos de la página.
- Abierta fuera de claude.ai, la página funciona en modo de vista previa (sin guardar y sin agenda).
