const express = require('express');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt')
const mysql = require('mysql2');
const session = require('express-session');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const xlsx = require('xlsx');
const multer = require('multer');
require('dotenv').config();

app.use(bodyParser.urlencoded({ extended: true }));

// Configuración de la base de datos
const connection = mysql.createConnection({
  host: process.env.DB_HOST,       // Host desde .env
  user: process.env.DB_USER,       // Usuario desde .env
  password: process.env.DB_PASS,   // Contraseña desde .env
  database: process.env.DB_NAME    // Nombre de la base de datos desde .env
});

// Configuración de la sesión
app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: false,
}));

// Conectar a la base de datos MySQL
connection.connect(err => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err);
    return;
  }
  console.log('Conexión exitosa a la base de datos');
});

// Configuración de Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//FUNCION PARA ROLES Y REQUERIMIENTOS
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
}

function requireRole(roles) {
  return (req, res, next) => {
      if (req.session.user && roles.includes(req.session.user.tipo_usuario)) {
          next();
      } else {
          res.status(403).send('Acceso denegado');
      }
  };
}

// Ruta para que solo laborista pueda ver todos los usuarios
app.get('/ver-usuarios', requireLogin, requireRole('laborista'), (req, res) => {
  const query = 'SELECT * FROM usuarios';
  connection.query(query, (err, results) => {
      if (err) return res.send('Error al obtener usuarios');

      let html = `
          <html>
          <head>
            <link rel="stylesheet" href="/styles.css">
            <title>Registros</title>
          </head>
          <body>
            <h2>Registros</h2>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Nombre usuario</th>
                  <th>Tipo de usuario</th>
                </tr>
              </thead>
              <tbody>
        `;
    
        results.forEach(usuario => {
            html += `
              <tr>
                <td>${usuario.id}</td>
                <td>${usuario.nombre_usuario}</td>
                <td>${usuario.tipo_usuario}</td>
              </tr>
            `;
        });
    
        html += `
              </tbody>
            </table>
            <button onclick="window.location.href='/'">Volver</button>
          </body>
          </html>
        `;
    
        res.send(html);
    });
  });

app.get('/ver-mis-datos', requireLogin, requireRole('paciente'),(req, res) => {
  const userId = req.session.user.nombre_usuario;
  const query = 'SELECT * FROM pacientes WHERE nombre = ?';
  connection.query(query,[userId],(err, results) => {
    if (err) {
      return res.send('Error al obtener los datos del paciente.');
    }

    let html = `
        <html>
        <head>
          <link rel="stylesheet" href="/styles.css">
          <title>Mis datos</title>
        </head>
        <body>
          <h2>Mis datos</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nombre</th>
                <th>Edad</th>
                <th>Correo</th>
                <th>Tipo de prueba</th>
                <th>Fecha de registro</th>
              </tr>
            </thead>
            <tbody>
      `;

      results.forEach(paciente => {
          html += `
            <tr>
              <td>${paciente.id}</td>
              <td>${paciente.nombre}</td>
              <td>${paciente.edad}</td>
              <td>${paciente.correo}</td>
              <td>${paciente.tipo_prueba}</td>
              <td>${paciente.fecha_registro}</td>
            </tr>
          `;
      });

      html += `
            </tbody>
          </table>
          <button onclick="window.location.href='/'">Volver</button>
        </body>
        </html>
      `;

      res.send(html);
  });
});


// Ruta para la página principal
app.get('/', requireLogin,(req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir archivos estáticos (HTML)
app.use(express.static(path.join(__dirname, 'public')));


// Registro de usuario
app.post('/registrar', (req, res) => {
  const { nombre_usuario, password, codigos_acceso } = req.body;

  const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
  connection.query(query, [codigos_acceso], (err, results) => {
      if (err || results.length === 0) {
          return res.send('Código de acceso inválido');
      }

      const tipo_usuario = results[0].tipo_usuario;
      const passwordHash = bcrypt.hashSync(password, 10);
  
      const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuario) VALUES (?, ?, ?)';
      connection.query(insertUser, [nombre_usuario, passwordHash, tipo_usuario], (err) => {
          if (err) return res.send('Error al registrar usuario');
          res.redirect('/login.html');
      });
  });
});

// Iniciar sesión
app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;

  connection.query('SELECT * FROM usuarios WHERE nombre_usuario = ?', 
    [nombre_usuario], async (err, results) => {
    if (err || results.length === 0) {
      return res.send('Usuario no encontrado.');
    }

    const user = results[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (match) {
      req.session.userId = user.id;
    } else {
      res.send('Contraseña incorrecta.');
    }
    req.session.user = {
          id: user.id,
          nombre_usuario: user.nombre_usuario,
          tipo_usuario: user.tipo_usuario // Aquí se establece el tipo de usuario en la sesión
      };
      // Redirigir al usuario a la página principal
      res.redirect('/');
  });
});

// Ruta para obtener el tipo de usuario actual
app.get('/tipo-usuario', requireLogin, (req, res) => {
  res.json({ tipo_usuario: req.session.user.tipo_usuario });
});

// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

//EXCEL
const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('excelFile'), requireLogin, requireRole('laborista'), (req, res) => {
  const filePath = req.file.path;
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

  data.forEach(row => {
    const { nombre_paciente, nombre_prueba, resultados, costo} = row;
    const sql = `INSERT INTO resultados (nombre_paciente, nombre_prueba, resultados, costo) VALUES (?, ?, ?, ?)`;
    connection.query(sql, [nombre_paciente, nombre_prueba, resultados, costo], err => {
      if (err) throw err;
    });
  });

  res.send('<h1>Archivo cargado y datos guardados</h1><a href="/archivos.html">Volver</a>');
});

//RUTA PARA ACTUALIZAR DATOS DEL PACIENTE
app.post('/actualizar-paciente', requireLogin, requireRole ('laborista'), (req, res) => {
  const {name, age, email, tipo_prueba, fecha_registro, id } = req.body;
  const query = 'UPDATE pacientes SET nombre = ?, edad = ?, correo = ?, tipo_prueba = ?, fecha_registro = ? WHERE id = ?';
  connection.query(query, [name, age, email, tipo_prueba, fecha_registro, id], (err, result) => {
    if (err) {
      return res.send('Error al actualizar los datos en la base de datos.');
    }
    res.send(`Paciente ${name} actualizado en la base de datos.`);
  });
});

//RUTA PARA ELIMINAR PACIENTE
app.post('/eliminar-paciente', requireLogin, requireRole ('laborista'), (req, res) => {
  const {id } = req.body;

  const query = 'DELETE FROM pacientes WHERE id = ?';
  connection.query(query, [id], (err, result) => {
    if (err) {
      return res.send('Error al eliminar al paciente de la base de datos.');
    }
    res.send(`Paciente eliminado en la base de datos.`);
  });
});

// Ruta para ordenar pacientes por nombre ASC (A-Z)
app.get('/ordenar-pacientes', requireLogin, requireRole('laborista'), (req, res) => {
  const query = 'SELECT * FROM pacientes ORDER BY nombre ASC';

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes Ordenados</title>
      </head>
      <body>
        <h2>Pacientes Ordenados por nombre</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Edad</th>
              <th>correo</th>
              <th>tipo de prueba</th>
              <th>fecha de registro</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.id}</td>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.correo}</td>
          <td>${paciente.tipo_prueba}</td>
          <td>${paciente.fecha_registro}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/extra.html'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ruta para CONTAR los pacientes registrados (COUNT)
app.get('/contar-pacientes', requireLogin, requireRole('laborista'), (req, res) => {
  const query = 'SELECT COUNT(*) AS total_registros FROM pacientes';

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes Registrados</title>
      </head>
      <body>
        <h2>Total de pacientes registrados</h2>
        <table>
          <thead>
            <tr>
              <th>Pacientes registrados:</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.total_registros}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/extra.html'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});


// Ruta para guardar datos de un paciente nuevo en la base de datos
app.post('/submit-data', requireLogin, requireRole ('laborista'), (req, res) => {
  const { name, age, email, tipo_prueba, fecha_registro } = req.body;

  const query = 'INSERT INTO pacientes (nombre, edad, correo, tipo_prueba, fecha_registro) VALUES (?, ?, ?, ?, ?)';
  connection.query(query, [name, age, email, tipo_prueba, fecha_registro], (err, result) => {
    if (err) {
      return res.send('Error al guardar los datos en la base de datos.');
    }
    res.send(`Paciente ${name} guardado en la base de datos.`);
  });
});


// Ruta para mostrar los datos de la base de datos en formato HTML
app.get('/pacientes', requireLogin, requireRole('laborista'), (req, res) => {
  connection.query('SELECT * FROM pacientes', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Pacientes</title>
      </head>
      <body>
        <h2>Pacientes Registrados</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Correo</th>
              <th>Tipo de prueba</th>
              <th>Fecha de registro</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.id}</td>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.correo}</td>
          <td>${paciente.tipo_prueba}</td>
          <td>${paciente.fecha_registro}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

//RUTA PARA LA VISTA (SANGRE Y EDAD >=20)
app.get('/pacientes-vista', requireLogin, requireRole('laborista'), (req, res) => {
  connection.query('SELECT * FROM vista_pacientes_sangre', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Vista Pacientes</title>
      </head>
      <body>
        <h2>Pacientes con analisis de sangre y edad mayor o igual a 20</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nombre</th>
              <th>Edad</th>
              <th>Tipo de prueba</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(paciente => {
      html += `
        <tr>
          <td>${paciente.id}</td>
          <td>${paciente.nombre}</td>
          <td>${paciente.edad}</td>
          <td>${paciente.tipo_prueba}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/extra.html'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

// Ruta para mostrar la edad PROMEDIO de los pacientes
app.get('/edadprom', requireLogin, requireRole('laborista'), (req, res) => {
  connection.query('SELECT AVG(edad) AS edad_prom FROM pacientes', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Edad promedio de pacientes</title>
      </head>
    `;

    results.forEach(paciente => {
      html += `
          <h2>Edad promedio: ${paciente.edad_prom}</h2>
      `;
    });

    html += `
          </tbody>
        <button onclick="window.location.href='/extra.html'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

//RUTA PARA BUSCAR UN PACIENTE EN TIEMPO REAL
app.get('/buscar', requireLogin, requireRole('laborista'), (req, res) => {
  const query = req.query.query;
  const sql = `SELECT id, nombre, edad, correo, tipo_prueba, fecha_registro FROM pacientes WHERE nombre LIKE ?`;
  connection.query(sql, [`%${query}%`], (err, results) => {
    if (err) throw err;
    res.json(results);    
  });
});

//RUTA PARA DESCARGAR EXCEL
app.get('/download',requireLogin, requireRole('laborista'), (req, res) => {
  const sql = `SELECT * FROM resultados`;
  connection.query(sql, (err, results) => {
    if (err) throw err;

    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Resultados');

    const filePath = path.join(__dirname, 'uploads', 'resultados.xlsx');
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, 'resultados.xlsx');
  });
});


//RUTA PARA DESCARGAR PDF
app.get('/downloadpdf', requireLogin, (req, res) => {
  //DISTINCT La función DISTINCT es una cláusula en SQL que se utiliza para eliminar filas duplicadas en el resultado de una consulta. 
  const sql = 'SELECT DISTINCT * FROM resultados';
  connection.query(sql, (err, results) => {
    if (err) {
      console.error("Error al consultar la base de datos:", err);
      return res.status(500).send('Error al obtener los datos.');
    }

    // Crear el documento PDF
    const doc = new PDFDocument({ autoFirstPage: false }); // Desactivar la creación automática de página
    const filePath = path.join(__dirname, 'uploads', 'resultadosPDF.pdf');

    // Crear el archivo PDF en el sistema de archivos
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Agregar una página al documento
    doc.addPage();

    // Título
    doc.fontSize(16).text('RESULTADOS DE ANALISIS DEL PACIENTE', { align: 'center' }).moveDown();
    
    // Subtítulo
    doc.fontSize(12).text('En vamiLabs revisamos sus analisis con cuidado arrojaron lo siguiente', { align: 'center' }).moveDown(2);

    // Cabecera de la tabla
    doc.fontSize(10).text('El paciente presenta en el analisis:', { align: 'left' }).moveDown();
    

    // Establecer el formato para las filas de la tabla
    results.forEach((resultados, index) => {
      // Cada fila con los datos de los resultados
      doc.text(`${resultados.nombre_paciente} ${resultados.nombre_prueba} ${resultados.resultados} ${resultados.costo}`, { align: 'left' }).moveDown();
    });

    // Finalizar el documento
    doc.end();

    // Cuando el archivo se haya generado, permitir la descarga
    stream.on('finish', () => {
      res.download(filePath, 'resultadosPDF.pdf', (err) => {
        if (err) {
          console.error('Error al descargar el archivo:', err);
          res.status(500).send('Error al descargar el archivo.');
        } else {
          // Eliminar el archivo temporal después de la descarga
          fs.unlinkSync(filePath);
        }
      });
    });
  });
});

// Ruta para eliminar una columna 
app.post('/eliminar-columna', requireLogin, requireRole('laborista'), (req, res) => {
  const { columna } = req.body;

  if (!columna) {
      return res.status(400).send('Por favor proporciona un nombre de columna válido.');
  }
  //tabla medicamentos es la prueba para no borrar la tabla pacientes
  const query = `ALTER TABLE pacientes DROP COLUMN ${columna}`;

  connection.query(query, (err, result) => {
      if (err) {
          console.error('Error eliminando la columna:', err);
          return res.status(500).send('Hubo un error eliminando la columna.');
      }
      let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <h2> La columna ${columna} ha sido eliminada con éxito</h2>
      </head>
    `;
  
    html += `
        <button onclick="window.location.href='/'">Volver</button>
      </html>
    `;
    res.send(html);
  });
});

// Ruta para insertar una columna
app.post('/insertar-columna', requireLogin, requireRole('laborista'), (req, res) => {
  const { columna, tipo } = req.body;

  if (!columna || !tipo) {
    return res.status(400).send('Por favor proporciona un nombre de columna y un tipo de dato válidos.');
  }

  const query = `ALTER TABLE pacientes ADD COLUMN ${columna} ${tipo}`;
  connection.query(query, (err, result) => {
    if (err) {
      console.error('Error al agregar la columna:', err);
      return res.status(500).send('Hubo un error al agregar la columna.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Columna Agregada</title>
      </head>
      <body>
        <h2>La columna "${columna}" de tipo "${tipo}" ha sido agregada con éxito.</h2>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});


// Iniciar el servidor
app.listen(3000, () => {
  console.log('Servidor corriendo en http://localhost:3000');
});
