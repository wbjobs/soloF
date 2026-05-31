#include "mainwindow.h"
#include "ui_mainwindow.h"
#include "modbusparser.h"
#include "historydialog.h"
#include <QDateTime>
#include <QMessageBox>
#ifdef Q_OS_LINUX
#include <QFile>
#endif

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
    , m_serialPort(new QSerialPort(this))
    , m_autoScroll(true)
    , m_dbManager(new DatabaseManager(this))
{
    ui->setupUi(this);
    populateSerialParameters();
    setupConnections();
    updatePortStatus(false);
    m_dbManager->initDatabase();
}

MainWindow::~MainWindow()
{
    if (m_serialPort->isOpen()) {
        m_serialPort->close();
    }
    delete ui;
}

void MainWindow::setupConnections()
{
    connect(ui->comboBox_port, QOverload<int>::of(&QComboBox::currentIndexChanged),
            this, &MainWindow::onPortChanged);
    connect(ui->pushButton_open, &QPushButton::clicked, this, &MainWindow::onOpenPort);
    connect(ui->pushButton_close, &QPushButton::clicked, this, &MainWindow::onClosePort);
    connect(ui->pushButton_refresh, &QPushButton::clicked, this, &MainWindow::onRefreshPorts);
    connect(ui->pushButton_sendCustom, &QPushButton::clicked, this, &MainWindow::onSendCustomFrame);
    connect(ui->pushButton_clearReceive, &QPushButton::clicked, this, &MainWindow::onClearReceive);
    connect(ui->pushButton_clearSend, &QPushButton::clicked, this, &MainWindow::onClearSend);
    connect(ui->checkBox_autoscroll, &QCheckBox::stateChanged, this, &MainWindow::onAutoScrollChanged);
    connect(ui->pushButton_history, &QPushButton::clicked, this, &MainWindow::onShowHistory);

    connect(m_serialPort, &QSerialPort::readyRead, this, &MainWindow::onDataReceived);
}

void MainWindow::populateSerialParameters()
{
    onRefreshPorts();

    ui->comboBox_baud->addItem("1200", QSerialPort::Baud1200);
    ui->comboBox_baud->addItem("2400", QSerialPort::Baud2400);
    ui->comboBox_baud->addItem("4800", QSerialPort::Baud4800);
    ui->comboBox_baud->addItem("9600", QSerialPort::Baud9600);
    ui->comboBox_baud->addItem("19200", QSerialPort::Baud19200);
    ui->comboBox_baud->addItem("38400", QSerialPort::Baud38400);
    ui->comboBox_baud->addItem("57600", QSerialPort::Baud57600);
    ui->comboBox_baud->addItem("115200", QSerialPort::Baud115200);
    ui->comboBox_baud->setCurrentIndex(3);

    ui->comboBox_data->addItem("5", QSerialPort::Data5);
    ui->comboBox_data->addItem("6", QSerialPort::Data6);
    ui->comboBox_data->addItem("7", QSerialPort::Data7);
    ui->comboBox_data->addItem("8", QSerialPort::Data8);
    ui->comboBox_data->setCurrentIndex(3);

    ui->comboBox_stop->addItem("1", QSerialPort::OneStop);
    ui->comboBox_stop->addItem("1.5", QSerialPort::OneAndHalfStop);
    ui->comboBox_stop->addItem("2", QSerialPort::TwoStop);
    ui->comboBox_stop->setCurrentIndex(0);

    ui->comboBox_parity->addItem("无", QSerialPort::NoParity);
    ui->comboBox_parity->addItem("奇", QSerialPort::OddParity);
    ui->comboBox_parity->addItem("偶", QSerialPort::EvenParity);
    ui->comboBox_parity->setCurrentIndex(0);
}

void MainWindow::updatePortStatus(bool isOpen)
{
    ui->pushButton_open->setEnabled(!isOpen);
    ui->pushButton_close->setEnabled(isOpen);
    ui->comboBox_port->setEnabled(!isOpen);
    ui->comboBox_baud->setEnabled(!isOpen);
    ui->comboBox_data->setEnabled(!isOpen);
    ui->comboBox_stop->setEnabled(!isOpen);
    ui->comboBox_parity->setEnabled(!isOpen);

    if (isOpen) {
        ui->label_status->setText(QString("状态: 已连接 - %1").arg(m_serialPort->portName()));
        ui->label_status->setStyleSheet("color: green;");
    } else {
        ui->label_status->setText("状态: 未连接");
        ui->label_status->setStyleSheet("color: red;");
    }
}

void MainWindow::onPortChanged(int index)
{
    Q_UNUSED(index);
}

void MainWindow::onOpenPort()
{
    if (ui->comboBox_port->count() == 0) {
        QMessageBox::warning(this, "警告", "没有可用的串口");
        return;
    }

    QString portName = ui->comboBox_port->currentData().toString();
    m_serialPort->setPortName(portName);

    m_serialPort->setBaudRate(static_cast<QSerialPort::BaudRate>(
        ui->comboBox_baud->currentData().toInt()));
    m_serialPort->setDataBits(static_cast<QSerialPort::DataBits>(
        ui->comboBox_data->currentData().toInt()));
    m_serialPort->setStopBits(static_cast<QSerialPort::StopBits>(
        ui->comboBox_stop->currentData().toInt()));
    m_serialPort->setParity(static_cast<QSerialPort::Parity>(
        ui->comboBox_parity->currentData().toInt()));

    if (m_serialPort->open(QIODevice::ReadWrite)) {
        updatePortStatus(true);
        m_receiveBuffer.clear();
    } else {
        QString errorMsg = m_serialPort->errorString();
        QString fullMsg = QString("无法打开串口: %1").arg(errorMsg);

#ifdef Q_OS_LINUX
        if (errorMsg.contains("Permission denied") || errorMsg.contains("权限")) {
            QString devicePath = QString("/dev/%1").arg(portName);
            fullMsg += QString("\n\n权限不足，请在终端执行以下命令：\nsudo chmod 666 %1\n\n或者将当前用户添加到dialout组：\nsudo usermod -aG dialout $USER\n（添加组后需要重启或重新登录）").arg(devicePath);
        }
#endif

        QMessageBox::critical(this, "错误", fullMsg);
    }
}

void MainWindow::onClosePort()
{
    if (m_serialPort->isOpen()) {
        m_serialPort->close();
        updatePortStatus(false);
    }
}

void MainWindow::onDataReceived()
{
    QByteArray data = m_serialPort->readAll();
    m_receiveBuffer.append(data);

    static const int MIN_FRAME_SIZE = 4;
    while (m_receiveBuffer.size() >= MIN_FRAME_SIZE) {
        processModbusFrame(m_receiveBuffer);
        m_receiveBuffer.clear();
        break;
    }
}

void MainWindow::processModbusFrame(const QByteArray &frame)
{
    QString timestamp = QDateTime::currentDateTime().toString("yyyy-MM-dd hh:mm:ss.zzz");

    QString hexStr = ModbusParser::frameToHexString(frame);
    appendReceiveData(QString("[%1] 接收: %2\n").arg(timestamp, hexStr));

    ModbusFrame parsed = ModbusParser::parseRtuFrame(frame);
    QString parsedStr = ModbusParser::parsedFrameToString(parsed);
    appendReceiveData(QString("解析:\n%1\n\n").arg(parsedStr));

    if (parsed.isValid) {
        m_dbManager->insertRecord(parsed, frame);
    }
}

void MainWindow::onSendCustomFrame()
{
    if (!m_serialPort->isOpen()) {
        QMessageBox::warning(this, "警告", "请先打开串口");
        return;
    }

    uint8_t slaveAddr = static_cast<uint8_t>(ui->spinBox_slave->value());
    uint16_t regAddr = static_cast<uint16_t>(ui->spinBox_regAddr->value());
    uint16_t quantity = static_cast<uint16_t>(ui->spinBox_quantity->value());

    QByteArray frame;
    int funcIndex = ui->comboBox_func->currentIndex();

    switch (funcIndex) {
    case 0:
        frame = ModbusParser::buildReadHoldingRegistersRequest(slaveAddr, regAddr, quantity);
        break;
    case 1:
        frame = ModbusParser::buildReadInputRegistersRequest(slaveAddr, regAddr, quantity);
        break;
    case 2:
        frame = ModbusParser::buildWriteSingleRegisterRequest(slaveAddr, regAddr, quantity);
        break;
    case 3: {
        QVector<uint16_t> values;
        values.append(quantity);
        frame = ModbusParser::buildWriteMultipleRegistersRequest(slaveAddr, regAddr, values);
        break;
    }
    default:
        return;
    }

    m_serialPort->write(frame);

    QString timestamp = QDateTime::currentDateTime().toString("yyyy-MM-dd hh:mm:ss.zzz");
    QString hexStr = ModbusParser::frameToHexString(frame);
    appendReceiveData(QString("[%1] 发送: %2\n\n").arg(timestamp, hexStr));

    ModbusFrame parsed = ModbusParser::parseRtuFrame(frame);
    if (parsed.isValid) {
        m_dbManager->insertRecord(parsed, frame);
    }

    ui->label_framePreview->setText(QString("帧预览: %1").arg(hexStr));
}

void MainWindow::onClearReceive()
{
    ui->textEdit_receive->clear();
}

void MainWindow::onClearSend()
{
    ui->label_framePreview->setText("帧预览:");
}

void MainWindow::onRefreshPorts()
{
    ui->comboBox_port->clear();
    const auto ports = QSerialPortInfo::availablePorts();
    for (const QSerialPortInfo &port : ports) {
        ui->comboBox_port->addItem(QString("%1 - %2").arg(port.portName(), port.description()),
            port.portName());
    }
}

void MainWindow::onAutoScrollChanged(int state)
{
    m_autoScroll = (state == Qt::Checked);
}

void MainWindow::appendReceiveData(const QString &text)
{
    ui->textEdit_receive->append(text);
    if (m_autoScroll) {
        QTextCursor cursor = ui->textEdit_receive->textCursor();
        cursor.movePosition(QTextCursor::End);
        ui->textEdit_receive->setTextCursor(cursor);
    }
}

void MainWindow::onShowHistory()
{
    HistoryDialog dialog(m_dbManager, this);
    dialog.exec();
}
