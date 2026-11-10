# Mi Fitbit (tablero)

Tablero de tendencias de la Fitbit Air: https://claude.ai/artifact/KybHKafQeqd3yDfRxyHTpP

- `index.html`: la página (gráficas de sueño, horario, pasos, ejercicio por semana, peso, pulso en reposo, VFC, oxígeno y respiración; tabla de sesiones).
- `fuentes.json`: de dónde salen los números. Dos consultas en vivo al conector **Fit Bit** (`serie_diaria` y `sesiones_ejercicio`), con el periodo elegido en la página (30, 60 o 90 días).

El tablero vive en claude.ai; estos archivos son una copia de referencia. Los datos no se guardan aquí: se leen de Google Health cada vez que se abre.
