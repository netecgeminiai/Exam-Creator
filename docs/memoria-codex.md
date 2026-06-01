# Memoria Codex - Exam-Creator

Ultima actualizacion: 2026-06-01

## Proposito del repo

Herramienta para convertir PDFs de examenes de certificacion Microsoft en simuladores interactivos en espanol. El sistema extrae preguntas, detecta tipo de pregunta, traduce/estructura con LLM y permite presentar el examen en una interfaz web.

## Estado observado

- Remoto: `https://github.com/netecgeminiai/Exam-Creator.git`
- Rama local activa: `master`
- `origin/HEAD`: `origin/master`
- Estado local al 2026-06-01: limpio y alineado con `origin/master`.
- Nota: existe `origin/main`, pero la rama principal activa del repo es `master`.

## Estructura relevante

- `README.md`: vision general, quick start y variables de entorno.
- `backend/`: API FastAPI, parser, modelos y proveedores.
- `frontend/`: frontend React + Vite para carga y simulacion.
- `data_output/`: salidas generadas o muestras.
- `test_parser.py`: pruebas/manual checks del parser.
- `requirements.txt`: dependencias Python.

## Historial reciente relevante

- Reparacion profunda del parser PapaParse eliminando BOM/caracteres invisibles.
- Correccion de CORS y parseo HTML estricto en el visualizador.
- Restauracion/generacion de examen FullStack de 40 items y visualizador HTML.

## Proximos pasos sugeridos

- Evitar confundir `master` con `main` al crear PRs o comandos de sincronizacion.
- Reforzar pruebas del parser para PDFs reales y casos de preguntas mixtas.
- Mantener claves LLM fuera del repo; usar variables de entorno como indica el README.
- Revisar si `data_output/` debe versionar muestras o solo artefactos generados.

## Como retomar

Leer este archivo y `README.md`. Confirmar rama con `git branch -vv -a` antes de operar, porque el repo conserva ramas `master` y `main`.
