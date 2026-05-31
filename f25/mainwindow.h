#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSerialPort>
#include <QSerialPortInfo>
#include <QTimer>
#include "databasemanager.h"

QT_BEGIN_NAMESPACE
namespace Ui { class MainWindow; }
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private slots:
    void onPortChanged(int index);
    void onOpenPort();
    void onClosePort();
    void onDataReceived();
    void onSendCustomFrame();
    void onClearReceive();
    void onClearSend();
    void onRefreshPorts();
    void onAutoScrollChanged(int state);
    void onShowHistory();

private:
    Ui::MainWindow *ui;
    QSerialPort *m_serialPort;
    QByteArray m_receiveBuffer;
    bool m_autoScroll;
    DatabaseManager *m_dbManager;

    void setupConnections();
    void populateSerialParameters();
    void updatePortStatus(bool isOpen);
    void appendReceiveData(const QString &text);
    void processModbusFrame(const QByteArray &frame);
};

#endif
