# Modelo de dominio financiero

El dominio transforma datos confirmados en una descripción explicable de la situación financiera. No mueve dinero, no estima rendimientos ni decide por la persona: calcula, muestra evidencia y conserva cada aceptación o corrección.

## Principios

1. Un borrador nunca afecta cifras financieras.
2. El dinero es exacto y siempre lleva moneda.
3. Un período pertenece a una zona horaria y tiene límites inmutables.
4. Una recomendación conserva datos, política, versión y confianza.
5. Los siete bolsillos son particiones virtuales de planificación.
6. Impuestos y emergencias representan necesidades diferentes.
7. Un insight informa; no cambia automáticamente transacciones ni planes.

## Contextos y conceptos

| Contexto | Conceptos principales |
|---|---|
| Perfil | Propietario, locale, zona horaria, moneda predeterminada, consentimientos y parámetros personales |
| Libro | Transacción, revisión, tipo, fecha de negocio y origen |
| Captura | Activo, ejecución, extracción, confianza y borrador |
| Categorización | Categoría, naturaleza financiera, regla y preferencia por comercio |
| Insights | Snapshot mensual, métricas, calidad del dato y patrón de gasto |
| Planificación | Capacidad, recomendación, política, plan y asignación virtual |

## Valores fundamentales

### Dinero

Un valor de dinero contiene:

- Importe decimal exacto.
- Código de moneda ISO 4217.
- Escala válida para la moneda en la frontera de confirmación.

#### Reglas

| ID | Invariante |
|---|---|
| INV-DIN-01 | Todo importe de transacción es mayor que cero; ingreso o gasto define el signo económico |
| INV-DIN-02 | Dominio, API y web no realizan aritmética monetaria con coma flotante binaria |
| INV-DIN-03 | La API serializa importes como cadenas decimales y la web usa aritmética decimal cuando calcula |
| INV-DIN-04 | La escala se valida con el exponente de la moneda: existen monedas de cero, dos, tres y otras unidades menores definidas por ISO 4217 |
| INV-DIN-05 | PostgreSQL conserva precisión suficiente para la moneda; la presentación redondea solo en la frontera de salida |
| INV-DIN-06 | El importe y la moneda originales nunca se sustituyen por una conversión derivada |

Para repartir una cantidad entre bolsillos se redondea a la unidad menor de la moneda mediante una política estable. El residuo se asigna por mayor resto y orden determinista para que la suma de las partes sea exactamente igual al ahorro total.

### Conversión de moneda

La conversión queda fuera del MVP. Los reportes agrupan por moneda y no muestran un total combinado.

Una evolución futura deberá modelar una conversión como dato derivado con:

- Moneda de origen y destino.
- Tasa decimal.
- Fuente.
- Fecha y hora de vigencia.
- Política de redondeo.
- Importe original inmutable.

Sin esos elementos, una suma multimoneda es inválida.

### Fecha de negocio e instante

| Concepto | Uso |
|---|---|
| Fecha de negocio | Día local al que pertenece el ingreso o gasto |
| Zona horaria de origen | Identificador IANA utilizado para interpretar el día |
| Instante registrado | Momento UTC en que el sistema recibió el dato |
| Instante confirmado | Momento UTC de la acción explícita de confirmación |
| Período | Inicio local inclusivo y comienzo del mes siguiente exclusivo |

Cambiar la zona horaria del perfil solo afecta nuevas entradas y vistas futuras. No desplaza silenciosamente una transacción histórica a otro mes.

### Porcentaje

Los porcentajes de asignación se representan como unidades exactas con resolución de 0,01 puntos porcentuales. Los seis destinos de ahorro deben sumar 10.000 unidades, equivalentes al 100,00%.

No se guarda un plan si la suma es menor o mayor. La cuenta corriente no participa de esa suma.

## Agregados y entidades

### Perfil financiero

| Atributo conceptual | Propósito |
|---|---|
| Propietario | Límite de autorización |
| Locale e idioma | Formato y comunicación |
| Zona horaria | Períodos y fechas de negocio |
| Moneda predeterminada | Ayuda de entrada, no moneda global obligatoria |
| Fuentes de ingreso | Regularidad y declaración de ingreso no sujeto a retención |
| Parámetros de ahorro | Margen de seguridad, metas y preferencias |
| Consentimientos | Proveedores y conservación de activos |

El sistema no infiere una situación fiscal a partir del comercio, país o profesión. Cualquier ingreso no sujeto a retención y tasa de reserva es una declaración de la persona.

### Transacción

Una transacción confirmada contiene como mínimo:

- Propietario.
- Tipo ingreso o gasto.
- Dinero.
- Fecha de negocio y zona horaria de origen.
- Concepto o contraparte.
- Categoría o estado explícito `Sin categorizar`.
- Origen manual, ticket o voz.
- Instante y actor de confirmación.
- Revisión vigente y trazabilidad de cambios.

| ID | Invariante |
|---|---|
| INV-TRX-01 | Solo el estado confirmado participa en agregados |
| INV-TRX-02 | Una anulación no borra el historial; deja de participar desde la revisión que la registra |
| INV-TRX-03 | Editar importe, moneda, fecha, tipo o categoría crea una revisión y desencadena invalidación |
| INV-TRX-04 | Una referencia de captura puede originar como máximo una transacción confirmada |
| INV-TRX-05 | Una transacción pertenece a un propietario y nunca se reasigna |
| INV-TRX-06 | La procedencia inferida se conserva aunque la persona corrija el valor |

### Borrador de transacción

El borrador pertenece a Captura y puede tener campos incompletos. Nunca es una transacción parcialmente válida.

#### Campos que requieren una decisión explícita antes de confirmar

- Tipo ingreso o gasto.
- Importe.
- Moneda.
- Fecha de negocio.
- Concepto o comercio.
- Categoría, incluida la elección consciente `Sin categorizar`.

La acción `Confirmar movimiento` debe ser inequívoca. Abrir, visualizar o editar un borrador no lo confirma.

| ID | Invariante |
|---|---|
| INV-BOR-01 | Confirmador e instante son obligatorios para pasar a transacción |
| INV-BOR-02 | Todos los campos inferidos muestran procedencia; los dudosos se destacan, pero ninguno se confirma automáticamente |
| INV-BOR-03 | Un borrador descartado o vencido no puede confirmarse sin crear una nueva versión válida |
| INV-BOR-04 | Error o cuota de proveedor produce estado manual requerido, no una transacción vacía |

### Confianza de extracción

La confianza numérica de proveedores distintos no es directamente comparable. Cada adaptador conserva el valor original y lo traduce a una banda configurable según calibración:

| Banda | Interpretación de interfaz |
|---|---|
| Desconocida | El proveedor no informa confianza o el campo fue derivado |
| Baja | Requiere atención destacada; valor probablemente incompleto o conflictivo |
| Media | Evidencia razonable, todavía necesita revisión |
| Alta | Evidencia fuerte, todavía necesita confirmación humana |

Como punto de partida, un adaptador puede marcar baja por debajo de 0,80 y alta desde 0,95, pero estos umbrales se validarán con tickets y audios representativos antes de convertirse en política. Importe, moneda y fecha siempre se presentan para revisión aunque la confianza sea alta.

### Duplicados

La idempotencia y la detección semántica son problemas diferentes:

- Repetir la misma petición con su clave devuelve el resultado existente.
- Reprocesar la misma captura y versión no crea otro borrador activo.
- Confirmar una captura ya confirmada devuelve su transacción.
- Subir un archivo con checksum ya visto o introducir importe, fecha y comercio similares genera una advertencia.
- La advertencia no bloquea automáticamente: dos compras reales pueden tener el mismo importe y comercio.

No se utiliza una ventana heurística como sustituto de una restricción de origen.

### Categoría

Una categoría tiene nombre localizable, propietario cuando es personalizada, estado y naturaleza financiera.

| Naturaleza | Uso analítico |
|---|---|
| Ingreso | Fuente de recursos |
| Esencial | Necesidad básica o compromiso difícil de reducir |
| Discrecional | Consumo opcional susceptible de análisis de patrón |
| Obligación | Impuesto, deuda u obligación declarada |
| Sin categorizar | Calidad pendiente; visible en todos los reportes |

Las categorías globales utilizan claves estables y etiquetas traducibles. Una categoría personalizada no se comparte entre perfiles. Archivar una categoría no modifica el historial.

### Activo, ejecución y extracción

| Concepto | Responsabilidad |
|---|---|
| Activo | Referencia privada, checksum, tipo real, propietario y retención |
| Ejecución | Intento idempotente de un proceso y versión de adaptador |
| Extracción | Valores brutos/normalizados, procedencia y confianza |
| Borrador | Selección editable de valores propuesta a la persona |

Una nueva versión de OCR o parser puede crear una nueva versión del borrador, pero no sobrescribe evidencia que ya originó una transacción.

### Snapshot mensual

Un snapshot es inmutable y contiene una moneda, propietario, período, versión y conjunto exacto de revisiones de transacción.

Incluye:

- Ingresos confirmados.
- Gastos esenciales, discrecionales y obligaciones.
- Flujo neto observado.
- Proporción e importe sin categorizar.
- Ingresos/gastos extraordinarios señalados.
- Declaración de integridad del período.
- Métricas de regularidad y calidad.

Corregir una transacción no reescribe el snapshot: crea una versión nueva y marca resultados anteriores como desactualizados.

## Cierre mensual

### Elegibilidad

Un período puede cerrarse para recomendación cuando:

1. Ha terminado el mes calendario en la zona horaria del perfil.
2. Existe al menos un ingreso confirmado en la moneda analizada.
3. Solo se incluyen movimientos confirmados y no anulados.
4. La persona declara que el período es suficientemente completo.
5. Se informa cuánto permanece sin categorizar.
6. Se señalan anomalías detectadas, sin eliminarlas silenciosamente.

Un mes parcial puede mostrar un reporte provisional, pero no genera recomendación de ahorro.

### Reapertura

Una revisión posterior:

- Marca el cierre como desactualizado.
- Genera un snapshot nuevo al recalcular.
- Conserva el plan que la persona aceptó con su contexto original.
- Invita a revisar la recomendación; no cambia asignaciones históricas sin consentimiento.

## Recomendación de ahorro

### Variables por moneda

| Símbolo conceptual | Significado |
|---|---|
| Ingresos | Total confirmado del período |
| Gastos | Esenciales, discrecionales y obligaciones confirmadas |
| Excedente observado | Ingresos menos gastos |
| Margen de seguridad | Importe configurable que no se recomienda asignar |
| Objetivo de referencia | 10% de los ingresos confirmados |
| Capacidad | Máximo entre cero y excedente menos margen de seguridad |
| Ahorro recomendado | Menor entre objetivo de referencia y capacidad |
| Tasa recomendada | Ahorro recomendado dividido por ingresos |

#### Invariantes

| ID | Invariante |
|---|---|
| INV-AHO-01 | El 10% se calcula sobre ingresos confirmados, no sobre gastos ni excedente |
| INV-AHO-02 | La recomendación nunca es negativa ni supera la capacidad |
| INV-AHO-03 | Si gastos más margen igualan o superan ingresos, la recomendación es 0% |
| INV-AHO-04 | Cada ajuste respecto del 10% muestra el motivo y el importe que lo limita |
| INV-AHO-05 | La persona debe aceptar o editar antes de crear un plan de bolsillos |
| INV-AHO-06 | Cálculos y resultados pertenecen a una moneda; no se combinan períodos multimoneda |

El margen de seguridad es una política visible. Puede definirse como importe por moneda o porcentaje de ingresos/gastos esenciales. No se oculta dentro de la fórmula ni se cambia retroactivamente.

### Ejemplos explicativos

| Escenario | Resultado |
|---|---|
| Ingresos 3.000 EUR, gastos 2.500 EUR y margen 100 EUR | Objetivo 300 EUR, capacidad 400 EUR, recomendación 300 EUR o 10% |
| Ingresos 3.000 EUR, gastos 2.850 EUR y margen 100 EUR | Objetivo 300 EUR, capacidad 50 EUR, recomendación 50 EUR o 1,67% |
| Ingresos 3.000 EUR, gastos 3.100 EUR | Capacidad cero y recomendación 0%; el sistema explica el déficit |

Los ejemplos no prometen que el porcentaje sea apropiado para una persona concreta.

## Confianza de la recomendación

La confianza mide estabilidad y cobertura del dato, no calidad futura de una decisión.

### Factores

- Número de meses completos y consecutivos.
- Declaraciones de integridad.
- Porcentaje sin categorizar.
- Regularidad de ingresos.
- Meses con déficit.
- Peso de movimientos extraordinarios.
- Cambios recientes de moneda, empleo o política.

### Bandas iniciales

| Banda | Condición mínima orientativa |
|---|---|
| Insuficiente | Sin mes completo, sin ingreso positivo o sin declaración de integridad |
| Baja | Uno o dos meses válidos, más de 20% de gasto sin categorizar o anomalía material |
| Media | Entre tres y cinco meses, como máximo 10% sin categorizar y variabilidad de ingreso dentro del límite configurado |
| Alta | Al menos seis meses consecutivos, como máximo 5% sin categorizar, sin períodos omitidos y variabilidad baja |

Para ingresos regulares, la variabilidad puede medirse como desviación absoluta mediana respecto de la mediana. Los límites iniciales de revisión son 25% para confianza media y 15% para alta. Un perfil que declara ingresos irregulares muestra esa condición y no obtiene confianza alta solo por acumular meses.

Cualquier anomalía material puede bajar la banda. Los umbrales pertenecen a una versión de política y pueden calibrarse con evidencia; nunca se cambian en planes históricos.

Con un único mes la confianza es siempre baja y la interfaz debe mostrarlo de forma persistente.

## Siete particiones virtuales

La expresión `siete cuentas` significa exactamente:

- Una cuenta corriente virtual que conserva la parte de ingresos no asignada al ahorro.
- Seis bolsillos que reparten el 100% del ahorro recomendado.

No existen cuentas bancarias ni transferencias. Los importes son una proyección.

### Plantilla base corregida

| Posición | Partición | Porcentaje inicial del ahorro | Propósito |
|---|---|---:|---|
| 1 | Cuenta corriente | No aplica | Operación y gastos; conserva ingresos no asignados al ahorro |
| 2 | Independencia financiera | 40% | Capital de largo plazo, sin promesa de rentabilidad ni recomendación de producto |
| 3 | Crecimiento e ingresos | 30% | Formación, proyecto o negocio; reemplaza el nombre ambiguo `Cuenta millonaria` |
| 4 | Año sabático | 10% | Meta de descanso o experiencia planificada |
| 5 | Compras grandes | 10% | Fondo para compras al contado y metas concretas |
| 6 | Generosidad | 5% | Donaciones o regalos definidos por la persona |
| 7 | Fondo de emergencia | 5% | Imprevistos y pérdida temporal de ingresos |

Los seis porcentajes suman 100% del ahorro. El cambio de `Cuenta Impuestos` a `Fondo de emergencia` es deliberado: el ejemplo original describía imprevistos, no impuestos.

### Adaptabilidad

- El motor puede proponer porcentajes distintos y debe explicar cada cambio.
- La persona puede renombrar, ordenar y cambiar el objetivo de los seis bolsillos.
- Puede desactivar un bolsillo, pero antes de guardar debe redistribuir el porcentaje entre los activos.
- La cuenta corriente no puede desactivarse ni recibir un porcentaje del ahorro.
- El MVP conserva seis destinos activos como máximo y no permite anidarlos.
- Cambios se previsualizan inmediatamente y crean una nueva versión al aceptarse.
- Un plan nuevo parte de la recomendación vigente; no altera planes anteriores.

### Cálculo de importes

Cada bolsillo recibe el ahorro recomendado multiplicado por su porcentaje. El redondeo por unidad menor y el reparto determinista del residuo garantizan que los seis importes sumen exactamente el ahorro.

Con 300 EUR de ahorro y la plantilla base:

| Bolsillo | Importe |
|---|---:|
| Independencia financiera | 120 EUR |
| Crecimiento e ingresos | 90 EUR |
| Año sabático | 30 EUR |
| Compras grandes | 30 EUR |
| Generosidad | 15 EUR |
| Fondo de emergencia | 15 EUR |

La cuenta corriente proyectada conserva 2.700 EUR de los 3.000 EUR de ingresos antes de aplicar gastos. No representa el saldo bancario actual.

## Fondo de emergencia y reserva fiscal

### Fondo de emergencia

- Cubre imprevistos personales o pérdida de ingresos.
- Su meta puede expresarse como meses de gasto esencial.
- La referencia inicial configurable es tres meses, no una obligación universal.
- Mientras esté por debajo de la meta, la política puede recomendar elevar su porcentaje y reducir otros bolsillos, siempre con explicación.

### Reserva fiscal

- Cubre una obligación futura sobre ingresos que la persona declara como no sujetos a retención suficiente.
- No es un bolsillo para imprevistos ni una estimación automática de impuestos.
- La persona proporciona el ingreso afectado y una tasa orientativa obtenida de su propio criterio o asesoramiento profesional.
- El importe reservado se trata como obligación antes de calcular capacidad de ahorro discrecional.
- El sistema no selecciona tasa, jurisdicción, deducción ni estrategia fiscal.

Si existe reserva fiscal, se muestra fuera de los seis bolsillos de ahorro como obligación comprometida. La plantilla sigue teniendo siete particiones; no se renombra el fondo de emergencia como impuestos.

| ID | Invariante |
|---|---|
| INV-RES-01 | Fondo de emergencia y reserva fiscal no comparten nombre, propósito ni fórmula |
| INV-RES-02 | La reserva fiscal solo existe tras una declaración explícita de ingreso no retenido y tasa proporcionada por la persona |
| INV-RES-03 | El importe fiscal no puede superar el ingreso declarado multiplicado por la tasa proporcionada |
| INV-RES-04 | La reserva fiscal reduce capacidad antes de calcular ahorro; el fondo de emergencia recibe una parte del ahorro después |
| INV-RES-05 | Toda pantalla fiscal indica que es una provisión informativa, no cálculo ni asesoramiento tributario |

## Gastos hormiga

### Objetivo

Detectar patrones pequeños y repetitivos cuyo impacto agregado puede pasar inadvertido. El término se presenta de forma neutral como `gastos pequeños y repetitivos` en locales donde resulte más claro.

### Universo elegible

Solo participan transacciones:

- Confirmadas y no anuladas.
- De una misma moneda.
- Marcadas como discrecionales.
- Dentro de un período cerrado.

Se excluyen por defecto gastos esenciales, obligaciones, impuestos, devoluciones, ahorro, donaciones intencionales y elementos que la persona haya descartado como patrón.

### Política inicial configurable

Un grupo por comercio normalizado o categoría es candidato cuando cumple simultáneamente:

1. Tiene al menos tres operaciones en 30 días.
2. Su importe medio no supera el 1% de los ingresos del período; si además existe un límite absoluto configurado para esa moneda, se utiliza el menor de ambos.
3. Su suma alcanza al menos el 1% del gasto discrecional del período, para evitar alertas irrelevantes.
4. No pertenece a la lista de exclusión del perfil.

Si no existe ingreso positivo, se necesita un límite absoluto explícito para esa moneda; sin él no se emite el insight. La confianza no puede superar baja. Los valores 3, 1% y 1% son defaults de política, no definiciones universales; la persona puede ajustarlos.

### Resultado

Cada insight muestra:

- Comercio o categoría agrupada.
- Número de operaciones.
- Total y promedio.
- Frecuencia.
- Porcentaje del gasto discrecional.
- Transacciones incluidas.
- Confianza y período.
- Proyección puramente ilustrativa si el patrón se redujera.

La persona puede marcar `No es un gasto hormiga`, ajustar la categoría o silenciar el patrón durante 90 días. Esa decisión se conserva por perfil y política.

| ID | Invariante |
|---|---|
| INV-HOR-01 | Un gasto aislado nunca constituye patrón |
| INV-HOR-02 | La detección no mezcla monedas ni compara importes sin contexto |
| INV-HOR-03 | El primer mes produce confianza baja |
| INV-HOR-04 | Un insight no modifica ahorro, categorías ni bolsillos automáticamente |
| INV-HOR-05 | Toda cifra agregada enlaza a las transacciones que la justifican |

## Otros reportes

Por moneda y período se mostrarán:

- Ingresos, gastos y flujo neto.
- Gasto esencial, discrecional, obligaciones y sin categorizar.
- Distribución por categoría y comercio.
- Evolución diaria o semanal dentro del mes.
- Tasa de ahorro observada y recomendada como conceptos separados.
- Calidad del dato y transacciones pendientes.
- Insights aceptados, activos o descartados.

Los gráficos siempre tienen tabla o resumen textual equivalente.

## Versionado y auditoría

### Política financiera

Cada cálculo conserva:

- ID y versión de política.
- Parámetros efectivos.
- Snapshot de entrada.
- Resultados intermedios relevantes.
- Motivos y advertencias.
- Banda de confianza.

### Plan aceptado

Cada versión de plan conserva:

- Recomendación original.
- Porcentajes propuestos.
- Porcentajes finales elegidos.
- Importes redondeados.
- Nombres y orden de bolsillos.
- Aceptación del aviso informativo.
- Instante y locale de presentación.

Nunca se recalcula un plan histórico con una política nueva sin crear otra versión.

## Límite de asesoramiento

Antes de aceptar el primer plan, la persona debe reconocer un aviso visible y localizable equivalente a:

> Esta aplicación ofrece información y simulaciones educativas. No proporciona asesoramiento financiero, fiscal, legal ni de inversión. Verifica decisiones relevantes con un profesional cualificado para tu situación y jurisdicción.

Además:

- No se recomiendan productos, activos, créditos, seguros ni proveedores concretos.
- No se prometen rendimientos, independencia financiera ni ahorro futuro.
- No se calculan impuestos ni optimizaciones fiscales.
- No se prescribe consolidación de deuda.
- Cada resultado usa lenguaje de posibilidad, rango y confianza, nunca garantía.

## Casos límite

| Caso | Comportamiento |
|---|---|
| Cero ingresos | Reporte disponible; recomendación insuficiente o 0%, sin división por cero |
| Gastos superiores a ingresos | Ahorro 0%, déficit visible y sin bolsillos ficticios |
| Varias monedas | Un snapshot y recomendación por moneda |
| Devolución | Revisión o movimiento con tratamiento explícito; no gasto hormiga |
| Ticket duplicado | Advertencia; guardas de origen impiden doble confirmación de la misma captura |
| Mes parcial | Reporte provisional, sin recomendación |
| Muchos movimientos sin categorizar | Confianza reducida y advertencia |
| Ingreso extraordinario | Se incluye, se señala y puede limitar confianza |
| Redondeo de asignaciones | Resto distribuido de forma determinista; total exacto |
| Cambio de zona horaria | Datos históricos mantienen período original |
| Política nueva | Solo afecta nuevos cálculos y versiones |

## Trazabilidad

| Área del dominio | Requisitos principales |
|---|---|
| Dinero y tiempo | RN-002 a RN-005, RF-010 a RF-016 |
| Borradores y confirmación | RF-020 a RF-037, RN-001 y RN-006 |
| Categorías | RF-040 a RF-044 |
| Reportes y gastos hormiga | RF-050 a RF-058, RN-010 a RN-012 |
| Ahorro y bolsillos | RF-060 a RF-069, RN-007 a RN-009 y RN-014 |
| Reserva fiscal y emergencia | RF-069 y RN-013 |
| Control de datos | RF-070 a RF-074 |

## Documentos relacionados

- [Requisitos del producto](01-requisitos-producto.md)
- [Arquitectura de solución](03-arquitectura-solucion.md)
- [Seguridad y privacidad](05-seguridad-privacidad.md)
- [Roadmap y validación](06-roadmap-validacion.md)
