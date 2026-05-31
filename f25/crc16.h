#ifndef CRC16_H
#define CRC16_H

#include <QByteArray>
#include <cstdint>

class Crc16
{
public:
    static uint16_t calculate(const QByteArray &data);
    static QByteArray appendCrc(const QByteArray &data);
    static bool verifyCrc(const QByteArray &data);

private:
    static const uint16_t crcTable[256];
};

#endif
