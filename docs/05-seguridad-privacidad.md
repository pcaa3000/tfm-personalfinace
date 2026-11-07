# Seguridad y privacidad

La plataforma trata información financiera, imágenes de compras y voz. Por eso aplica minimización, autorización por propietario y borrado verificable desde el primer diseño. Este documento define una base técnica internacional; no certifica cumplimiento legal en todas las jurisdicciones.

## Objetivos de seguridad

1. Impedir que una persona acceda a datos de otra.
2. Evitar confirmaciones, duplicados o cambios financieros no autorizados.
3. Reducir exposición de imágenes, audios, transcripciones y notas.
4. Limitar daño y coste ante archivos maliciosos, abuso o fallo de proveedores.
5. Mantener trazabilidad sin copiar contenido financiero en logs.
6. Permitir acceso, exportación, rectificación y eliminación.
7. Hacer explícito cuándo un tercero procesa datos.

## Alcance y modelo de confianza

### Confiable bajo control del producto

- Casos de uso de dominio y aplicación.
- PostgreSQL como fuente de verdad.
- Adaptadores configurados y credenciales de servicio.
- Pipelines de entrega autorizados.

### No confiable por defecto

- Navegador y cualquier campo enviado por cliente.
- Nombres, extensiones, MIME y metadatos de archivos.
- Tokens sin validar completamente.
- Jobs repetidos o fuera de orden.
- Respuestas de OCR y voz.
- URLs proporcionadas por la persona.
- Logs, cabeceras o errores provenientes de terceros.
- Dependencias y artefactos de suministro hasta su verificación.

### Fronteras externas

- Proveedor OIDC.
- Almacenamiento de objetos gestionado.
- Azure AI Document Intelligence.
- Azure AI Speech.
- Backend de telemetría.
- Infraestructura de correo del proveedor de identidad, si se habilita recuperación.

## Clasificación de datos

| Clase | Ejemplos | Tratamiento mínimo |
|---|---|---|
| Pública | Documentación y textos de producto | Integridad y control de publicación |
| Interna | Métricas agregadas sin identidad, configuración no secreta | Acceso operativo y retención acotada |
| Personal | Issuer–subject, locale, zona horaria, preferencias | Cifrado, acceso por necesidad y exportación/borrado |
| Financiera sensible | Transacciones, categorías, comercios, planes e insights | Autorización por propietario, cifrado, auditoría y no inclusión en logs |
| Contenido altamente sensible | Tickets, audio, texto OCR, transcripción y notas | Retención mínima, objetos privados, proveedor consentido y descarga firmada |
| Secreta | Claves, tokens, credenciales, cookies y material criptográfico | Gestor de secretos, rotación, nunca repositorio/log/cliente |

## Datos que no se recopilan

- Credenciales bancarias.
- Números completos de tarjeta o códigos de seguridad.
- Documentos de identidad o identificadores fiscales como requisito del MVP.
- Voz biométrica, voiceprints o identificación de hablante.
- Grabación continua o en segundo plano.
- Ubicación GPS de una imagen.
- Contactos, historial del navegador o archivos no elegidos explícitamente.
- Información destinada a vender publicidad o perfilar a terceros.

Si un ticket incluye datos de tarjeta, dirección u otra información incidental, se trata como contenido altamente sensible y se minimiza después de la extracción.

## Amenazas y controles

| Amenaza | Impacto | Controles principales |
|---|---|---|
| Toma de cuenta | Lectura o modificación total del perfil | OIDC, recuperación segura, MFA opcional, tokens breves, revocación y alertas |
| IDOR o fallo de autorización | Acceso cruzado entre perfiles | Propietario derivado del token, filtros de repositorio obligatorios, pruebas negativas y IDs opacos |
| Robo de token por XSS | Suplantación | CSP estricta, salida escapada, sin token en `localStorage`, dependencias controladas y vida corta |
| Redirect OIDC malicioso | Robo de código/token | Redirect URIs exactas, PKCE, state, nonce, issuer y audience validados |
| Archivo manipulado | Ejecución, parser exploit o agotamiento | Cuarentena, allowlist, tipo real, límites, decodificación aislada y normalización |
| Abuso de URL firmada | Lectura/escritura ajena | Clave no predecible, propietario vinculado, expiración breve, método/tamaño limitados y bucket privado |
| Repetición de job | Duplicado financiero | Jobs encolados en la misma transacción (pg-boss), IDs deterministas, guardas de unicidad e idempotencia de negocio |
| Respuesta falsa o errónea de IA | Movimiento incorrecto | Adaptador anticorrupción, evidencia por campo y confirmación humana obligatoria |
| Exposición en logs | Fuga silenciosa y masiva | Lista de campos prohibidos, redacción, revisión de telemetría y pruebas |
| Abuso de cuota | Coste o denegación a otros usuarios | Límites por identidad/IP, presupuestos, timeouts, reintentos acotados y kill switch |
| Acceso operativo indebido | Violación de privacidad | Mínimo privilegio, separación de roles, auditoría y ausencia de superusuario ordinario |
| Backup u objeto huérfano | Datos que sobreviven al borrado | Inventario, lifecycle, jobs de reconciliación y ventana máxima de backup |
| Dependencia comprometida | Ejecución o exfiltración | Lockfile, versiones maduras, escaneo, provenance y actualización de seguridad |
| Cola offline expuesta en el dispositivo | Lectura de registros y medios encolados por acceso físico al navegador | Cola mínima y visible, borrado tras sincronización exitosa, vaciado al cerrar sesión y ausencia de datos sensibles en `localStorage` |
| Configuración cloud pública | Fuga de objetos o base | Infraestructura privada, revisión automatizada y pruebas de acceso externo |
| Inferencia por reportes | Revelar hábitos sensibles | Autorización del agregado y del detalle; no compartir URLs permanentes |

## Identidad y sesión

### Flujo requerido

- OpenID Connect con Authorization Code y PKCE; no implicit flow.
- La persona puede autenticarse con usuario y contraseña, un proveedor social (Google, Facebook u otro habilitado) o una passkey.
- State y nonce únicos por intento.
- Redirect URIs exactas por entorno, sin comodines amplios.
- Access tokens de vida corta y no persistidos en almacenamiento accesible a JavaScript.
- La API valida firma, algoritmo permitido, issuer, audience, expiración y not-before mediante metadatos/JWKS confiables.
- El perfil se enlaza por issuer–subject. El correo es atributo modificable, no clave de propiedad.
- El logout limpia sesión local, vacía la cola local de la PWA e inicia cierre OIDC cuando esté disponible. La sesión demo termina además por cierre de la aplicación o 10 minutos de inactividad, descartando cualquier modificación.
- Los errores de autenticación no revelan si una cuenta concreta existe.

La autenticación social y las passkeys se delegan por completo al proveedor OIDC gestionado (Supabase Auth en etapa 1). No se implementan credenciales propias en la API.

### Tokens

- No se registran ni se incluyen en URLs.
- No se envían a OCR, voz, objetos ni telemetría.
- El backend no acepta un issuer o JWKS arbitrario indicado por el cliente.
- La caché de claves tiene expiración y recuperación controlada; una clave desconocida fuerza actualización segura, no desactiva validación.

## Autorización

### Regla principal

El workspace se obtiene del contexto autenticado. Un ID de usuario o workspace enviado en ruta, consulta o cuerpo nunca concede acceso.

Cada caso de uso y repositorio aplica:

- Identidad interna resuelta desde issuer–subject.
- Filtro de propietario en lectura y escritura.
- Validación de pertenencia de captura, objeto, categoría, transacción, reporte y plan.
- Respuesta indistinguible entre recurso inexistente y recurso ajeno cuando revelar existencia sea un riesgo.

### Roles

| Rol | Permiso |
|---|---|
| Usuario | Recursos de su workspace |
| Operación | Salud, métricas y fallos técnicos sin contenido financiero ordinario |

No existe un rol administrativo con lectura implícita de todas las finanzas. Una futura asistencia excepcional requerirá consentimiento, acceso temporal, motivo y auditoría independiente.

### Defensa en profundidad

Pueden utilizarse permisos de esquema o Row Level Security cuando el diseño de conexión permita propagar el contexto de forma segura. Nunca sustituyen la autorización en la aplicación.

## Seguridad web y API

- TLS obligatorio fuera de desarrollo local.
- HSTS, política de tipo de contenido, referrer restrictivo y permisos explícitos de cámara/micrófono.
- CSP sin scripts inline no autorizados y allowlist mínima de orígenes.
- CORS limitado a orígenes web conocidos; credenciales y cabeceras según el flujo elegido.
- Validación de longitud, formato, rango y campos inesperados en toda entrada.
- Consultas parametrizadas mediante el adaptador de persistencia.
- Salida escapada y texto de OCR/voz tratado como contenido, nunca como HTML.
- Rate limit por IP, identidad y operación sensible.
- Límites de paginación y complejidad de filtros.
- Claves de idempotencia vinculadas a identidad y operación.
- Errores públicos sin stack, SQL, ruta interna, nombre de bucket ni respuesta bruta del proveedor.
- Swagger UI y descripciones de API no se exponen públicamente en producción salvo autenticación y necesidad explícita.

Si en el futuro se utilizan cookies para una sesión propia, deberán ser Secure, HttpOnly y SameSite apropiado, y toda operación mutante deberá protegerse contra CSRF. El MVP no asume que una cookie resuelva por sí sola el modelo de sesión.

## Carga segura de tickets

### Política inicial

| Propiedad | Límite de referencia |
|---|---|
| Tipos | JPEG, PNG y HEIF/HEIC solo si existe decoder seguro; PDF y TIFF fuera del MVP |
| Tamaño de subida | 12 MB antes de normalización |
| Dimensiones | 25 megapíxeles antes de reducción segura |
| Páginas | Una imagen por captura |
| URL de subida | Máximo 10 minutos y una clave concreta |
| URL de lectura | Máximo 5 minutos, emitida tras autorización |

Los límites son configuración de seguridad y pueden reducirse para cumplir la cuota del adaptador OCR.

### Secuencia

1. La API crea una captura pendiente después de comprobar identidad y cuota.
2. Genera una clave aleatoria bajo un prefijo no controlado por la persona.
3. Firma una única operación de subida con tipo y tamaño esperados.
4. Tras la subida, verifica existencia, tamaño y checksum.
5. El objeto permanece en cuarentena sin URL pública.
6. Un worker aislado comprueba firma real y decodifica con límites; el escaneo de malware y detección de contenido poliglota se incorporan en etapa 2.
7. Se eliminan EXIF, GPS y miniaturas; el original temporal se sustituye por una copia normalizada cuando corresponda.
8. Solo entonces se autoriza el envío mínimo al proveedor OCR.

La extensión y el `Content-Type` declarados no son prueba suficiente. El sistema no descarga URLs arbitrarias proporcionadas por usuarios, lo que reduce SSRF.

## Captura segura de voz

| Propiedad | Límite de referencia |
|---|---|
| Duración | 60 segundos por clip |
| Tamaño | 10 MB antes de normalización |
| Formatos | Allowlist de formatos generados por navegadores soportados y WAV; siempre decodificados/normalizados |
| Grabación | Solo tras acción explícita, con indicador persistente y control de detener |

- No se mantiene el micrófono activo entre capturas.
- No se realiza identificación, emoción, edad, género ni voiceprint.
- La normalización se ejecuta con límites de CPU, memoria, disco temporal y tiempo.
- El archivo temporal local se elimina al finalizar el trabajo.
- El texto transcrito se trata con la misma sensibilidad que el audio.

## Proveedores de OCR y voz

### Consentimiento informado

Antes del primer envío a cada proveedor, la interfaz debe informar:

- Nombre del proveedor.
- Tipo de dato enviado.
- Finalidad concreta.
- Región configurada cuando se conozca.
- Retención contractual y mecanismo de eliminación.
- Uso o no uso para entrenamiento según contrato vigente.
- Enlace al aviso aplicable.
- Existencia de entrada manual como alternativa.

La aceptación se registra con versión de aviso, finalidad, proveedor, instante y locale. Rechazar no bloquea el registro manual.

### Revocación

- Detiene nuevos envíos inmediatamente.
- No elimina transacciones ya confirmadas.
- Encola eliminación de activos y respuestas temporales bajo control propio.
- Solicita eliminación al proveedor cuando la API y el contrato lo permitan.
- Informa qué datos no pueden recuperarse o borrarse de forma instantánea por limitaciones contractuales o backups.

No se afirma que una revocación borre retroactivamente una llamada ya completada sin evidencia del proveedor.

### Minimización

- El proveedor recibe el activo necesario y un ID técnico no identificable.
- No recibe issuer, subject, correo, plan financiero, notas ni historial.
- Las claves se utilizan exclusivamente en servidor.
- La respuesta bruta tiene acceso restringido y retención breve.
- No se habilita entrenamiento con datos del producto salvo contrato específico, necesidad aprobada y consentimiento separado.

Antes de una operación comercial se debe revisar DPA, subprocessors, residencia, transferencias internacionales y respuesta a solicitudes de derechos.

## Retención y eliminación

Los siguientes valores son defaults del TFM y deben ser configurables cuando una obligación legal o producto aprobado lo requiera.

| Dato | Retención predeterminada | Eliminación o excepción |
|---|---|---|
| Imagen de ticket u original de audio | 30 días desde la captura | Borrado anticipado disponible sin afectar la transacción confirmada; nunca se extiende más allá de 30 días |
| Captura encolada offline en la PWA | Hasta sincronización exitosa o fin de sesión | Se elimina del dispositivo al sincronizar o al cerrar sesión |
| Audio fallido pendiente de reintento | 7 días o antes del máximo de 30 días | Se elimina antes si se descarta o revoca consentimiento |
| Borrador sin confirmar | 30 días desde última acción | Expira y elimina contenido bruto asociado |
| Respuesta bruta OCR/voz | 7 días | Acceso restringido; la extracción normalizada conserva solo evidencia necesaria |
| Transcripción completa | Hasta confirmar/rechazar y máximo 30 días | Tras confirmar se conservan solo campos/evidencias mínimas; no audio |
| Transacción y revisiones | Vida de la cuenta | Se eliminan con la cuenta o antes por acción específica, salvo obligación documentada |
| Planes, snapshots e insights | Vida de la cuenta | Invalidación conserva versión; borrado de cuenta los elimina |
| Consentimientos | Vida de la cuenta y 30 días para completar borrado | Retención mayor solo con base legal documentada |
| Idempotencia y jobs finalizados | 30 días tras estado terminal | Evidencia mínima puede agregarse sin identidad |
| Logs, métricas y trazas | 30 días | Sin contenido financiero; incidentes aislados requieren justificación |
| Eventos del proveedor de identidad | 30 días por defecto | Configuración y obligación del proveedor pueden variar |
| Backups | Ventana móvil de 30 días | Un borrado debe desaparecer al rotar la copia, máximo operativo 35 días |

### Borrado específico

- Borrar una imagen o audio antes de sus 30 días no elimina la transacción confirmada.
- Borrar una transacción elimina contenido bruto y evidencia no necesaria asociada, invalida proyecciones y conserva solo una marca técnica no identificable cuando sea imprescindible para reconciliación.
- Una anulación financiera y un borrado por privacidad son operaciones diferentes.
- Objetos, base, caché, trabajos y copias se incluyen en el flujo de eliminación.
- Cada solicitud tiene estado visible: recibida, en proceso, sistemas activos completados, pendiente de backups y completada.

### Borrado de cuenta

1. Reautenticación y confirmación explícita.
2. Revocación de nuevas sesiones y trabajos.
3. Cancelación o descarte de capturas pendientes.
4. Eliminación de objetos y datos activos en un máximo operativo de 7 días.
5. Solicitudes aplicables a proveedores.
6. Rotación fuera de backups en un máximo de 35 días.
7. Confirmación final sin incluir datos ya eliminados.

Una obligación legal real puede impedir un borrado concreto; debe identificarse por jurisdicción, dato, fundamento y plazo. No se utiliza una excepción genérica.

## Exportación y portabilidad

La exportación requiere reautenticación y genera un paquete temporal protegido.

### Incluye

- Transacciones y revisiones vigentes.
- Categorías y reglas personales.
- Snapshots, recomendaciones, planes y asignaciones.
- Consentimientos y preferencias.
- Metadatos de captura y procedencia.
- Moneda ISO, importes decimales, fecha de negocio, zona horaria e instantes UTC.

### Formatos

- JSON para preservar estructura y metadatos.
- CSV por conjunto tabular para interoperabilidad.
- XLSX por reporte para uso en hojas de cálculo.
- Archivo separado de medios únicamente si la persona lo solicita y aún existen.

La URL de descarga es breve, de un solo propietario y no aparece en logs. El paquete se elimina automáticamente tras su ventana de descarga.

## Cifrado y secretos

### En tránsito

- TLS 1.2 como mínimo; preferencia por TLS 1.3 donde esté disponible.
- Verificación de certificados y host en API, proveedores, base y almacenamiento de objetos.
- Sin downgrade silencioso a conexiones inseguras.

### En reposo

- Cifrado gestionado para PostgreSQL, objetos y backups.
- Buckets privados sin ACL pública.
- Discos temporales efímeros y borrados tras el trabajo.
- Si el modelo de amenaza exige claves por tenant o campo, se documentará antes de incorporar cifrado de aplicación; no se improvisa criptografía propia.

### Secretos

- Gestor de secretos o mecanismo protegido de la plataforma.
- Nunca en código, frontend, imagen de contenedor, documentación, logs o repositorio.
- Identidades de servicio separadas por entorno y mínimo privilegio.
- Rotación y revocación ensayadas.
- Credenciales diferentes para API, worker, migraciones y solo lectura cuando corresponda.

## Base de datos y backups

- Roles con privilegios mínimos por proceso.
- Migraciones mediante identidad separada de runtime.
- Acceso de red restringido a servicios autorizados.
- Backups cifrados, monitorizados y con restauración probada.
- Restaurar en entorno aislado no habilita acceso humano indiscriminado.
- Datos de producción no se copian a desarrollo; fixtures son sintéticos o anonimizados de forma irreversible.
- Las consultas analíticas no evitan el filtro de propietario.

## Cola, jobs y eventos (pg-boss)

- Los jobs viven en tablas de PostgreSQL y heredan sus controles de acceso y backup; no hay un segundo almacén de estado que asegurar.
- El job se encola en la misma transacción que el cambio de negocio: no existe ventana de intención huérfana.
- Los payloads contienen IDs y referencias, no imagen, audio, token ni transcripción completa.
- Jobs y eventos se validan como entrada no confiable.
- Los workers aplican la misma autorización por workspace mediante datos canónicos, no claims transportados en el mensaje.
- IDs deterministas, versiones y guardas de unicidad evitan efectos duplicados.
- Reintentos están acotados; el dead-letter de pg-boss no reenvía automáticamente de forma infinita.

## Cola local de la PWA

- La cola offline en IndexedDB solo contiene altas y capturas creadas por la persona durante la sesión vigente.
- Cada ítem porta su clave de idempotencia; el servidor nunca confía en el contenido encolado más que como entrada a validar.
- La cola se vacía tras sincronizar con éxito y al cerrar sesión; en modo demo también al terminar la sesión por cierre o inactividad.
- La persona puede ver y descartar sus ítems pendientes; nada se sube sin volver la conexión.
- Se evalúa cifrado en reposo del dispositivo cuando exista soporte del navegador; el MVP minimiza el riesgo limitando qué se almacena y por cuánto tiempo.

## Logs, auditoría y observabilidad

### Permitido

- Instante.
- Servicio y entorno.
- Tipo de operación.
- ID opaco de recurso.
- Correlación.
- Estado, duración y clase de error.
- Contadores agregados de proveedor y cola.

### Prohibido

- Tokens, cookies, claves y URLs firmadas.
- Importe y moneda asociados a una identidad.
- Comercio, concepto, nota o categoría personal.
- Imagen, audio, OCR bruto o transcripción.
- Correo, issuer–subject o IP completa en telemetría general.
- Cuerpo completo de petición o respuesta.

La auditoría registra actor interno, acción, recurso opaco, revisión, resultado y motivo técnico. Los accesos operativos excepcionales, si se diseñan, deben quedar en un registro resistente a alteración.

## Control de abuso y costes

Se deben configurar y medir:

- Capturas por minuto, día y mes por perfil.
- Tamaño total y objetos activos por perfil.
- Duración de audio acumulada.
- Páginas OCR y segundos de voz consumidos.
- Concurrencia de jobs por proveedor.
- Timeouts, reintentos y circuit breaker.
- Presupuesto global y por entorno.
- Kill switch independiente para OCR y voz.

Al llegar al límite, la API responde con estado comprensible y entrada manual. Nunca continúa facturando mediante reintentos ocultos.

## Derechos y transparencia

La experiencia debe permitir:

- Consultar datos y procedencia.
- Corregir movimientos e inferencias.
- Exportar en formato interoperable.
- Eliminar activos, transacciones o cuenta.
- Cambiar conservación de tickets.
- Revocar consentimiento de proveedores.
- Conocer cuándo una recomendación es informativa y con qué datos se calculó.

La política pública debe identificar responsable, finalidades, categorías de datos, proveedores, transferencias, plazos, derechos y canal de contacto según la jurisdicción de lanzamiento.

## Base internacional de privacidad

Se adoptan como mínimos los principios de finalidad, minimización, exactitud, limitación de conservación, seguridad, transparencia y responsabilidad demostrable asociados a RGPD.

Esto no basta para operar globalmente. Antes de un lanzamiento comercial se debe determinar:

- Entidad responsable y jurisdicciones atendidas.
- Base jurídica por finalidad.
- Edad mínima y tratamiento de menores; el MVP no se dirige a menores.
- DPA y subprocessors.
- Residencia y transferencias internacionales.
- Plazos legales financieros o fiscales aplicables.
- Procedimiento de derechos y brechas.
- Necesidad de evaluación de impacto.

No se mostrará un sello o afirmación de `cumple RGPD` sin evaluación jurídica y evidencia operativa.

## Respuesta a incidentes

1. Detectar y clasificar alcance sin copiar datos sensibles a canales inseguros.
2. Contener credenciales, proveedor, endpoint o job afectado.
3. Preservar evidencia técnica mínima y controlar acceso.
4. Evaluar personas, datos, regiones y ventanas afectadas.
5. Corregir la causa y validar no recurrencia.
6. Notificar internamente y, cuando proceda, a personas y autoridades dentro del plazo legal aplicable.
7. Rotar secretos, revisar permisos y eliminar artefactos temporales.
8. Documentar aprendizaje y actualizar amenazas, controles y pruebas.

## Criterios de aceptación de seguridad

- [ ] Dos perfiles no pueden leer, modificar, descargar ni detectar recursos ajenos.
- [ ] Un token con firma, issuer, audience o expiración inválidos es rechazado.
- [ ] Ningún secreto o token aparece en bundle web, repositorio o logs.
- [ ] Una URL firmada no permite otra clave, método, tamaño o ventana.
- [ ] Extensión o MIME falsos no evitan la validación de contenido.
- [ ] EXIF/GPS se elimina antes de conservar la imagen normalizada.
- [ ] Audio superior al límite, continuo o sin permiso no se procesa.
- [ ] Ningún activo se envía a un proveedor sin consentimiento vigente.
- [ ] Revocar consentimiento detiene nuevos envíos y activa el flujo de eliminación aplicable.
- [ ] Repetir petición, evento o job no duplica borrador ni transacción.
- [ ] Logs y trazas no contienen datos incluidos en la lista prohibida.
- [ ] La exportación pertenece al solicitante, expira y conserva moneda/tiempo inequívocos.
- [ ] El borrado alcanza sistemas activos y tiene plazo visible para backups.
- [ ] Restauración de backup y rotación de secretos se prueban antes de producción.
- [ ] Agotar cuota externa conserva entrada manual y detiene reintentos facturables.

## Riesgos residuales

- Un proveedor puede interpretar incorrectamente contenido aunque el transporte sea seguro.
- La persona puede registrar un período incompleto y obtener una recomendación de baja calidad.
- Supabase concentra identidad, base y storage: simplifica operación pero concentra el riesgo de disponibilidad; los adaptadores mantienen la sustitución viable. La PWA conserva datos encolados en el dispositivo hasta sincronizar; el acceso físico al dispositivo desbloqueado es un riesgo residual mitigado por minimización y vaciado de sesión.
- Tickets y voz pueden contener datos de terceros que el sistema no detecte antes del primer OCR/transcripción.
- Un plazo contractual de proveedor o backup puede impedir borrado instantáneo.
- Las leyes y expectativas cambian por país; la arquitectura reduce impacto, pero no reemplaza revisión legal.

## Documentos relacionados

- [Requisitos del producto](01-requisitos-producto.md)
- [Stack tecnológico](02-stack-tecnologico.md)
- [Arquitectura de solución](03-arquitectura-solucion.md)
- [Modelo de dominio financiero](04-modelo-dominio-financiero.md)
- [Roadmap y validación](06-roadmap-validacion.md)
