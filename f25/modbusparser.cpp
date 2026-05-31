#include "modbusparser.h"
#include "crc16.h"

ModbusParser::ModbusParser(QObject *parent)
    : QObject{parent}
{}

ModbusFrame ModbusParser::parseRtuFrame(const QByteArray &frameData)
{
    ModbusFrame frame;
    frame.isValid = false;
    frame.isResponse = false;

    if (frameData.size() < 4) {
        frame.errorMessage = "帧长度不足";
        return frame;
    }

    if (!Crc16::verifyCrc(frameData)) {
        frame.errorMessage = "CRC校验失败";
        return frame;
    }

    frame.slaveAddress = static_cast<uint8_t>(frameData[0]);
    frame.functionCode = static_cast<uint8_t>(frameData[1]);

    uint8_t func = frame.functionCode;
    if (func >= 0x80) {
        frame.errorMessage = QString("异常响应: 异常码 %1").arg(static_cast<uint8_t>(frameData[2]));
        frame.isValid = true;
        return frame;
    }

    switch (func) {
    case 0x01:
    case 0x02:
    case 0x03:
    case 0x04:
        if (frameData.size() == 8) {
            frame.startAddress = (static_cast<uint8_t>(frameData[2]) << 8) | static_cast<uint8_t>(frameData[3]);
            frame.quantity = (static_cast<uint8_t>(frameData[4]) << 8) | static_cast<uint8_t>(frameData[5]);
            frame.data = frameData.mid(2, 4);
            frame.isResponse = false;
        } else if (frameData.size() > 4) {
            uint8_t byteCount = static_cast<uint8_t>(frameData[2]);
            frame.quantity = byteCount / 2;
            frame.data = frameData.mid(3, byteCount);
            frame.isResponse = true;
        }
        break;
    case 0x05:
    case 0x06:
        if (frameData.size() >= 6) {
            frame.startAddress = (static_cast<uint8_t>(frameData[2]) << 8) | static_cast<uint8_t>(frameData[3]);
            frame.data = frameData.mid(4, 2);
        }
        break;
    case 0x0F:
    case 0x10:
        if (frameData.size() >= 7) {
            frame.startAddress = (static_cast<uint8_t>(frameData[2]) << 8) | static_cast<uint8_t>(frameData[3]);
            frame.quantity = (static_cast<uint8_t>(frameData[4]) << 8) | static_cast<uint8_t>(frameData[5]);
            uint8_t byteCount = static_cast<uint8_t>(frameData[6]);
            frame.data = frameData.mid(7, byteCount);
        }
        break;
    default:
        frame.data = frameData.mid(2, frameData.size() - 4);
        break;
    }

    frame.crc = static_cast<uint8_t>(frameData[frameData.size() - 2]) |
                (static_cast<uint8_t>(frameData[frameData.size() - 1]) << 8);
    frame.isValid = true;
    return frame;
}

QString ModbusParser::functionCodeToString(uint8_t functionCode)
{
    switch (functionCode) {
    case 0x01: return "读线圈";
    case 0x02: return "读离散输入";
    case 0x03: return "读保持寄存器";
    case 0x04: return "读输入寄存器";
    case 0x05: return "写单个线圈";
    case 0x06: return "写单个寄存器";
    case 0x0F: return "写多个线圈";
    case 0x10: return "写多个寄存器";
    default: return QString("未知功能码 0x%1").arg(functionCode, 2, 16, QChar('0'));
    }
}

QString ModbusParser::frameToHexString(const QByteArray &frameData)
{
    QString hexStr;
    for (int i = 0; i < frameData.size(); ++i) {
        hexStr += QString("%1 ").arg(static_cast<uint8_t>(frameData[i]), 2, 16, QChar('0')).toUpper();
    }
    return hexStr.trimmed();
}

QString ModbusParser::parsedFrameToString(const ModbusFrame &frame)
{
    if (!frame.isValid) {
        return QString("无效帧: %1").arg(frame.errorMessage);
    }

    QString result;
    result += QString("从站地址: %1 (0x%2)\n").arg(frame.slaveAddress).arg(frame.slaveAddress, 2, 16, QChar('0'));
    result += QString("功能码: %1\n").arg(functionCodeToString(frame.functionCode));

    if (frame.functionCode < 0x80) {
        uint8_t func = frame.functionCode;

        if (frame.isResponse) {
            result += QString("寄存器数量: %1\n").arg(frame.quantity);
            result += QString("字节数: %1\n").arg(frame.data.size());
            if (!frame.data.isEmpty()) {
                result += QString("数据: %1\n").arg(frameToHexString(frame.data));
            }
        } else {
            if (func == 0x01 || func == 0x02 || func == 0x03 || func == 0x04 || func == 0x05 || func == 0x06 || func == 0x0F || func == 0x10) {
                result += QString("起始地址: %1 (0x%2)\n").arg(frame.startAddress).arg(frame.startAddress, 4, 16, QChar('0'));
            }
            if (frame.quantity > 0) {
                result += QString("数量: %1\n").arg(frame.quantity);
            }
            if (!frame.data.isEmpty()) {
                result += QString("数据: %1\n").arg(frameToHexString(frame.data));
            }
        }
    }

    result += QString("CRC: 0x%1").arg(frame.crc, 4, 16, QChar('0'));
    return result;
}

QByteArray ModbusParser::buildReadCoilsRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x01));
    frame.append(static_cast<char>((startAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(startAddr & 0xFF));
    frame.append(static_cast<char>((quantity >> 8) & 0xFF));
    frame.append(static_cast<char>(quantity & 0xFF));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildReadDiscreteInputsRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x02));
    frame.append(static_cast<char>((startAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(startAddr & 0xFF));
    frame.append(static_cast<char>((quantity >> 8) & 0xFF));
    frame.append(static_cast<char>(quantity & 0xFF));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildReadHoldingRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x03));
    frame.append(static_cast<char>((startAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(startAddr & 0xFF));
    frame.append(static_cast<char>((quantity >> 8) & 0xFF));
    frame.append(static_cast<char>(quantity & 0xFF));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildReadInputRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, uint16_t quantity)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x04));
    frame.append(static_cast<char>((startAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(startAddr & 0xFF));
    frame.append(static_cast<char>((quantity >> 8) & 0xFF));
    frame.append(static_cast<char>(quantity & 0xFF));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildWriteSingleCoilRequest(uint8_t slaveAddr, uint16_t coilAddr, bool value)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x05));
    frame.append(static_cast<char>((coilAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(coilAddr & 0xFF));
    frame.append(static_cast<char>(value ? 0xFF : 0x00));
    frame.append(static_cast<char>(0x00));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildWriteSingleRegisterRequest(uint8_t slaveAddr, uint16_t regAddr, uint16_t value)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x06));
    frame.append(static_cast<char>((regAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(regAddr & 0xFF));
    frame.append(static_cast<char>((value >> 8) & 0xFF));
    frame.append(static_cast<char>(value & 0xFF));
    return Crc16::appendCrc(frame);
}

QByteArray ModbusParser::buildWriteMultipleRegistersRequest(uint8_t slaveAddr, uint16_t startAddr, const QVector<uint16_t> &values)
{
    QByteArray frame;
    frame.append(static_cast<char>(slaveAddr));
    frame.append(static_cast<char>(0x10));
    frame.append(static_cast<char>((startAddr >> 8) & 0xFF));
    frame.append(static_cast<char>(startAddr & 0xFF));
    frame.append(static_cast<char>((values.size() >> 8) & 0xFF));
    frame.append(static_cast<char>(values.size() & 0xFF));
    frame.append(static_cast<char>(values.size() * 2));
    for (uint16_t value : values) {
        frame.append(static_cast<char>((value >> 8) & 0xFF));
        frame.append(static_cast<char>(value & 0xFF));
    }
    return Crc16::appendCrc(frame);
}
