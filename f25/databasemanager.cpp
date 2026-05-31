#include "databasemanager.h"
#include <QSqlError>
#include <QVariant>
#include <QDebug>

DatabaseManager::DatabaseManager(QObject *parent)
    : QObject{parent}
{
}

DatabaseManager::~DatabaseManager()
{
    if (m_db.isOpen()) {
        m_db.close();
    }
}

bool DatabaseManager::initDatabase()
{
    m_db = QSqlDatabase::addDatabase("QSQLITE");
    m_db.setDatabaseName("modbus_records.db");

    if (!m_db.open()) {
        qDebug() << "无法打开数据库:" << m_db.lastError().text();
        return false;
    }

    return createTables();
}

bool DatabaseManager::createTables()
{
    QSqlQuery query;
    QString sql = R"(
        CREATE TABLE IF NOT EXISTS modbus_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME NOT NULL,
            slave_address INTEGER NOT NULL,
            function_code INTEGER NOT NULL,
            start_address INTEGER NOT NULL,
            quantity INTEGER NOT NULL,
            hex_data TEXT NOT NULL,
            raw_frame TEXT NOT NULL,
            is_response INTEGER NOT NULL
        )
    )";

    if (!query.exec(sql)) {
        qDebug() << "创建表失败:" << query.lastError().text();
        return false;
    }

    sql = R"(
        CREATE INDEX IF NOT EXISTS idx_start_address ON modbus_records(start_address)
    )";
    query.exec(sql);

    sql = R"(
        CREATE INDEX IF NOT EXISTS idx_slave_address ON modbus_records(slave_address)
    )";
    query.exec(sql);

    sql = R"(
        CREATE INDEX IF NOT EXISTS idx_timestamp ON modbus_records(timestamp)
    )";
    query.exec(sql);

    return true;
}

bool DatabaseManager::insertRecord(const ModbusFrame &frame, const QByteArray &rawFrame)
{
    if (!m_db.isOpen()) {
        return false;
    }

    QSqlQuery query;
    query.prepare(R"(
        INSERT INTO modbus_records (
            timestamp, slave_address, function_code, start_address,
            quantity, hex_data, raw_frame, is_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    )");

    query.addBindValue(QDateTime::currentDateTime());
    query.addBindValue(frame.slaveAddress);
    query.addBindValue(frame.functionCode);
    query.addBindValue(frame.startAddress);
    query.addBindValue(frame.quantity);
    query.addBindValue(ModbusParser::frameToHexString(frame.data));
    query.addBindValue(ModbusParser::frameToHexString(rawFrame));
    query.addBindValue(frame.isResponse ? 1 : 0);

    if (!query.exec()) {
        qDebug() << "插入记录失败:" << query.lastError().text();
        return false;
    }

    return true;
}

QList<ModbusRecord> DatabaseManager::queryAllRecords()
{
    QList<ModbusRecord> records;

    QSqlQuery query("SELECT * FROM modbus_records ORDER BY timestamp DESC");
    while (query.next()) {
        ModbusRecord record;
        record.id = query.value(0).toLongLong();
        record.timestamp = query.value(1).toDateTime();
        record.slaveAddress = static_cast<uint8_t>(query.value(2).toInt());
        record.functionCode = static_cast<uint8_t>(query.value(3).toInt());
        record.startAddress = static_cast<uint16_t>(query.value(4).toInt());
        record.quantity = static_cast<uint16_t>(query.value(5).toInt());
        record.hexData = query.value(6).toString();
        record.rawFrame = query.value(7).toString();
        record.isResponse = query.value(8).toBool();
        records.append(record);
    }

    return records;
}

QList<ModbusRecord> DatabaseManager::queryByRegisterAddress(uint16_t startAddr, uint16_t endAddr)
{
    QList<ModbusRecord> records;

    QSqlQuery query;
    if (endAddr == 0 || endAddr == startAddr) {
        query.prepare("SELECT * FROM modbus_records WHERE start_address = ? ORDER BY timestamp DESC");
        query.addBindValue(startAddr);
    } else {
        query.prepare("SELECT * FROM modbus_records WHERE start_address >= ? AND start_address <= ? ORDER BY timestamp DESC");
        query.addBindValue(startAddr);
        query.addBindValue(endAddr);
    }

    if (query.exec()) {
        while (query.next()) {
            ModbusRecord record;
            record.id = query.value(0).toLongLong();
            record.timestamp = query.value(1).toDateTime();
            record.slaveAddress = static_cast<uint8_t>(query.value(2).toInt());
            record.functionCode = static_cast<uint8_t>(query.value(3).toInt());
            record.startAddress = static_cast<uint16_t>(query.value(4).toInt());
            record.quantity = static_cast<uint16_t>(query.value(5).toInt());
            record.hexData = query.value(6).toString();
            record.rawFrame = query.value(7).toString();
            record.isResponse = query.value(8).toBool();
            records.append(record);
        }
    }

    return records;
}

QList<ModbusRecord> DatabaseManager::queryBySlaveAddress(uint8_t slaveAddr)
{
    QList<ModbusRecord> records;

    QSqlQuery query;
    query.prepare("SELECT * FROM modbus_records WHERE slave_address = ? ORDER BY timestamp DESC");
    query.addBindValue(slaveAddr);

    if (query.exec()) {
        while (query.next()) {
            ModbusRecord record;
            record.id = query.value(0).toLongLong();
            record.timestamp = query.value(1).toDateTime();
            record.slaveAddress = static_cast<uint8_t>(query.value(2).toInt());
            record.functionCode = static_cast<uint8_t>(query.value(3).toInt());
            record.startAddress = static_cast<uint16_t>(query.value(4).toInt());
            record.quantity = static_cast<uint16_t>(query.value(5).toInt());
            record.hexData = query.value(6).toString();
            record.rawFrame = query.value(7).toString();
            record.isResponse = query.value(8).toBool();
            records.append(record);
        }
    }

    return records;
}

QList<ModbusRecord> DatabaseManager::queryByFunctionCode(uint8_t funcCode)
{
    QList<ModbusRecord> records;

    QSqlQuery query;
    query.prepare("SELECT * FROM modbus_records WHERE function_code = ? ORDER BY timestamp DESC");
    query.addBindValue(funcCode);

    if (query.exec()) {
        while (query.next()) {
            ModbusRecord record;
            record.id = query.value(0).toLongLong();
            record.timestamp = query.value(1).toDateTime();
            record.slaveAddress = static_cast<uint8_t>(query.value(2).toInt());
            record.functionCode = static_cast<uint8_t>(query.value(3).toInt());
            record.startAddress = static_cast<uint16_t>(query.value(4).toInt());
            record.quantity = static_cast<uint16_t>(query.value(5).toInt());
            record.hexData = query.value(6).toString();
            record.rawFrame = query.value(7).toString();
            record.isResponse = query.value(8).toBool();
            records.append(record);
        }
    }

    return records;
}

QList<ModbusRecord> DatabaseManager::queryByTimeRange(const QDateTime &start, const QDateTime &end)
{
    QList<ModbusRecord> records;

    QSqlQuery query;
    query.prepare("SELECT * FROM modbus_records WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp DESC");
    query.addBindValue(start);
    query.addBindValue(end);

    if (query.exec()) {
        while (query.next()) {
            ModbusRecord record;
            record.id = query.value(0).toLongLong();
            record.timestamp = query.value(1).toDateTime();
            record.slaveAddress = static_cast<uint8_t>(query.value(2).toInt());
            record.functionCode = static_cast<uint8_t>(query.value(3).toInt());
            record.startAddress = static_cast<uint16_t>(query.value(4).toInt());
            record.quantity = static_cast<uint16_t>(query.value(5).toInt());
            record.hexData = query.value(6).toString();
            record.rawFrame = query.value(7).toString();
            record.isResponse = query.value(8).toBool();
            records.append(record);
        }
    }

    return records;
}

bool DatabaseManager::clearAllRecords()
{
    QSqlQuery query;
    return query.exec("DELETE FROM modbus_records");
}

int DatabaseManager::getRecordCount()
{
    QSqlQuery query("SELECT COUNT(*) FROM modbus_records");
    if (query.next()) {
        return query.value(0).toInt();
    }
    return 0;
}
