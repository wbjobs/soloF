#ifndef MODBUSPARSER_H
#define MODBUSPARSER_H

#include <QObject>
#include <QByteArray>
#include <QString>
#include <cstdint>

struct ModbusFrame
{
    uint8_t slaveAddress;
    uint8_t functionCode;
    uint16_t startAddress;
    uint16_t quantity;
    QByteArray data;
    uint16_t crc;
    bool isValid;
    bool isResponse;
    QString errorMessage;
};

class ModbusParser : public QObject
{
    Q_OBJECT
public:
    explicit ModbusParser(QObject *parent = nullptr);

    static ModbusFrame parseRtuFrame(const QByteArray &frameData);
    static QString functionCodeToString(uint8_t functionCode);
    static QString frameToHexString(const QByteArray &frameData);
    static QString parsedFrameToString(const ModbusFrame &frame);

    static QByteArray buildReadCoilsRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity);
    static QByteArray buildReadDiscreteInputsRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity);
    static QByteArray buildReadHoldingRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity);
    static QByteArray buildReadInputRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity);
    static QByteArray buildWriteSingleCoilRequest(uint8_t slaveAddr, uint16_t coilAddr, bool value);
    static QByteArray buildWriteSingleRegisterRequest(uint8_t slaveAddr, uint16_t regAddr, uint16_t value);
    static QByteArray buildWriteMultipleRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, const QVector<uint16_t> &values);

signals:
};

#endif
