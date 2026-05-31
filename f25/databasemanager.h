#ifndef DATABASEMANAGER_H
#define DATABASEMANAGER_H

#include <QObject>
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QDateTime>
#include "modbusparser.h"

struct ModbusRecord
{
    qint64 id;
    QDateTime timestamp;
    uint8_t slaveAddress;
    uint8_t functionCode;
    uint16_t startAddress;
    uint16_t quantity;
    QString hexData;
    QString rawFrame;
    bool isResponse;
};

class DatabaseManager : public QObject
{
    Q_OBJECT
public:
    explicit DatabaseManager(QObject *parent = nullptr);
    ~DatabaseManager();

    bool initDatabase();
    bool insertRecord(const ModbusFrame &frame, const QByteArray &rawFrame);
    QList<ModbusRecord> queryAllRecords();
    QList<ModbusRecord> queryByRegisterAddress(uint16_t startAddr, uint16_t endAddr = 0);
    QList<ModbusRecord> queryBySlaveAddress(uint8_t slaveAddr);
    QList<ModbusRecord> queryByFunctionCode(uint8_t funcCode);
    QList<ModbusRecord> queryByTimeRange(const QDateTime &start, const QDateTime &end);
    bool clearAllRecords();
    int getRecordCount();

private:
    QSqlDatabase m_db;
    bool createTables();
};

#endif
