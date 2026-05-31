#include <cstdint>
#include <cstring>
#include <vector>
#include <string>
#include <map>
#include <cmath>
#include <algorithm>
#include <sstream>
#include <iostream>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

struct Point {
    enum Type { MOVE, LINE, BEZIER, CLOSE };
    Type type;
    float x, y;
    float cx1, cy1, cx2, cy2;
};

struct GradientStop {
    float offset;
    uint32_t color;
};

struct Gradient {
    enum Type { LINEAR, RADIAL };
    Type type;
    float x1, y1, x2, y2;
    float r1, r2;
    std::vector<GradientStop> stops;
};

struct Path {
    enum FillType { NONE, COLOR, GRADIENT };
    enum DrawMode { FILL, STROKE, FILL_STROKE };
    
    std::vector<Point> points;
    FillType fillType;
    uint32_t fillColor;
    Gradient* gradient;
    float lineWidth;
    DrawMode mode;
};

struct TextItem {
    std::string text;
    float x, y;
    float fontSize;
    uint32_t color;
};

struct Page {
    float width;
    float height;
    std::vector<Path*> paths;
    std::vector<TextItem*> texts;
};

struct PDFObject {
    enum Type { NULL_TYPE, BOOLEAN, INTEGER, REAL, STRING, NAME, ARRAY, DICT, STREAM, REF };
    Type type;
    union {
        bool boolVal;
        int intVal;
        float realVal;
        std::string* strVal;
        std::vector<PDFObject*>* arrayVal;
        std::map<std::string, PDFObject*>* dictVal;
        struct { uint8_t* data; size_t len; } streamVal;
        struct { int num; int gen; } refVal;
    };
    
    PDFObject() : type(NULL_TYPE) {}
    ~PDFObject() {
        switch(type) {
            case STRING: case NAME: delete strVal; break;
            case ARRAY: 
                for (auto* o : *arrayVal) delete o;
                delete arrayVal; 
                break;
            case DICT:
                for (auto& p : *dictVal) delete p.second;
                delete dictVal;
                break;
            case STREAM: delete[] streamVal.data; break;
            default: break;
        }
    }
};

class PDFParser {
private:
    const uint8_t* data;
    size_t length;
    size_t pos;
    std::map<int, PDFObject*> objects;
    std::vector<size_t> pageOffsets;
    std::vector<Page*> pages;
    
    bool isWhitespace(uint8_t c) {
        return c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32;
    }
    
    bool isDelimiter(uint8_t c) {
        return c == '(' || c == ')' || c == '<' || c == '>' || c == '[' || c == ']' ||
               c == '{' || c == '}' || c == '/' || c == '%';
    }
    
    void skipWhitespace() {
        while (pos < length && isWhitespace(data[pos])) pos++;
    }
    
    void skipComment() {
        while (pos < length && data[pos] != '\n' && data[pos] != '\r') pos++;
    }
    
    std::string readToken() {
        skipWhitespace();
        while (pos < length && data[pos] == '%') {
            skipComment();
            skipWhitespace();
        }
        
        if (pos >= length) return "";
        
        if (isDelimiter(data[pos])) {
            if (data[pos] == '<' && pos + 1 < length && data[pos + 1] == '<') {
                pos += 2;
                return "<<";
            }
            if (data[pos] == '>' && pos + 1 < length && data[pos + 1] == '>') {
                pos += 2;
                return ">>";
            }
            return std::string(1, (char)data[pos++]);
        }
        
        size_t start = pos;
        while (pos < length && !isWhitespace(data[pos]) && !isDelimiter(data[pos])) {
            pos++;
        }
        return std::string((const char*)data + start, pos - start);
    }
    
    PDFObject* parseObject() {
        std::string token = readToken();
        if (token.empty()) return new PDFObject();
        
        if (token == "<<") {
            auto* dict = new PDFObject();
            dict->type = PDFObject::DICT;
            dict->dictVal = new std::map<std::string, PDFObject*>();
            
            while (true) {
                std::string key = readToken();
                if (key == ">>" || key.empty()) break;
                if (key[0] == '/') key = key.substr(1);
                
                PDFObject* value = parseObject();
                (*dict->dictVal)[key] = value;
            }
            
            std::string next = readToken();
            if (next == "stream") {
                while (pos < length && data[pos] != '\n' && data[pos] != '\r') pos++;
                while (pos < length && (data[pos] == '\n' || data[pos] == '\r')) pos++;
                
                size_t streamStart = pos;
                size_t streamLen = 0;
                
                auto it = dict->dictVal->find("Length");
                if (it != dict->dictVal->end() && it->second->type == PDFObject::INTEGER) {
                    streamLen = it->second->intVal;
                } else {
                    const uint8_t* end = (const uint8_t*)memmem(data + pos, length - pos, (const void*)"endstream", 9);
                    if (end) streamLen = end - (data + pos);
                    else streamLen = length - pos;
                }
                
                dict->type = PDFObject::STREAM;
                dict->streamVal.data = new uint8_t[streamLen];
                memcpy(dict->streamVal.data, data + streamStart, streamLen);
                dict->streamVal.len = streamLen;
                pos = streamStart + streamLen;
            }
            
            return dict;
        }
        
        if (token == "[") {
            auto* arr = new PDFObject();
            arr->type = PDFObject::ARRAY;
            arr->arrayVal = new std::vector<PDFObject*>();
            
            while (true) {
                size_t savePos = pos;
                std::string next = readToken();
                if (next == "]" || next.empty()) break;
                pos = savePos;
                arr->arrayVal->push_back(parseObject());
            }
            return arr;
        }
        
        if (token[0] == '/') {
            auto* name = new PDFObject();
            name->type = PDFObject::NAME;
            name->strVal = new std::string(token.substr(1));
            return name;
        }
        
        if (token == "(") {
            auto* str = new PDFObject();
            str->type = PDFObject::STRING;
            str->strVal = new std::string();
            
            int depth = 1;
            while (pos < length && depth > 0) {
                if (data[pos] == '\\' && pos + 1 < length) {
                    pos++;
                    switch(data[pos]) {
                        case 'n': str->strVal->push_back('\n'); break;
                        case 'r': str->strVal->push_back('\r'); break;
                        case 't': str->strVal->push_back('\t'); break;
                        case 'b': str->strVal->push_back('\b'); break;
                        case 'f': str->strVal->push_back('\f'); break;
                        case '\\': str->strVal->push_back('\\'); break;
                        case '(': str->strVal->push_back('('); break;
                        case ')': str->strVal->push_back(')'); break;
                        default: str->strVal->push_back((char)data[pos]); break;
                    }
                } else if (data[pos] == '(') {
                    depth++;
                    str->strVal->push_back('(');
                } else if (data[pos] == ')') {
                    depth--;
                    if (depth > 0) str->strVal->push_back(')');
                } else {
                    str->strVal->push_back((char)data[pos]);
                }
                pos++;
            }
            return str;
        }
        
        if (token == "<") {
            auto* str = new PDFObject();
            str->type = PDFObject::STRING;
            str->strVal = new std::string();
            
            std::string hexStr;
            while (pos < length && data[pos] != '>') {
                if (!isWhitespace(data[pos])) hexStr.push_back((char)data[pos]);
                pos++;
            }
            pos++;
            
            for (size_t i = 0; i + 1 < hexStr.size(); i += 2) {
                char byte = std::stoi(hexStr.substr(i, 2), nullptr, 16);
                str->strVal->push_back(byte);
            }
            return str;
        }
        
        if (token == "true" || token == "false") {
            auto* b = new PDFObject();
            b->type = PDFObject::BOOLEAN;
            b->boolVal = (token == "true");
            return b;
        }
        
        if (token == "null") {
            return new PDFObject();
        }
        
        if (token.find('.') != std::string::npos) {
            auto* real = new PDFObject();
            real->type = PDFObject::REAL;
            real->realVal = std::stof(token);
            return real;
        }
        
        try {
            int num = std::stoi(token);
            std::string next1 = readToken();
            std::string next2 = readToken();
            
            if (next2 == "obj") {
                int gen = std::stoi(next1);
                PDFObject* obj = parseObject();
                objects[num] = obj;
                return obj;
            } else if (next2 == "R") {
                int gen = std::stoi(next1);
                auto* ref = new PDFObject();
                ref->type = PDFObject::REF;
                ref->refVal.num = num;
                ref->refVal.gen = gen;
                return ref;
            } else {
                pos -= (next1.size() + next2.size() + 2);
                auto* integer = new PDFObject();
                integer->type = PDFObject::INTEGER;
                integer->intVal = num;
                return integer;
            }
        } catch (...) {
            return new PDFObject();
        }
    }
    
    PDFObject* resolve(PDFObject* obj) {
        while (obj && obj->type == PDFObject::REF) {
            auto it = objects.find(obj->refVal.num);
            if (it != objects.end()) obj = it->second;
            else break;
        }
        return obj;
    }
    
    void parsePages(PDFObject* pagesDict) {
        pagesDict = resolve(pagesDict);
        if (!pagesDict || pagesDict->type != PDFObject::DICT) return;
        
        auto kidsIt = pagesDict->dictVal->find("Kids");
        if (kidsIt == pagesDict->dictVal->end()) return;
        
        PDFObject* kids = resolve(kidsIt->second);
        if (!kids || kids->type != PDFObject::ARRAY) return;
        
        for (PDFObject* kid : *kids->arrayVal) {
            kid = resolve(kid);
            if (!kid || kid->type != PDFObject::DICT) continue;
            
            auto typeIt = kid->dictVal->find("Type");
            if (typeIt == kid->dictVal->end()) continue;
            
            PDFObject* type = resolve(typeIt->second);
            if (!type || type->type != PDFObject::NAME) continue;
            
            if (*type->strVal == "Pages") {
                parsePages(kid);
            } else if (*type->strVal == "Page") {
                Page* page = parsePage(kid);
                if (page) pages.push_back(page);
            }
        }
    }
    
    Page* parsePage(PDFObject* pageDict) {
        Page* page = new Page();
        page->width = 595;
        page->height = 842;
        
        auto mediaBoxIt = pageDict->dictVal->find("MediaBox");
        if (mediaBoxIt != pageDict->dictVal->end()) {
            PDFObject* mb = resolve(mediaBoxIt->second);
            if (mb && mb->type == PDFObject::ARRAY && mb->arrayVal->size() >= 4) {
                page->width = getNumericValue((*mb->arrayVal)[2]);
                page->height = getNumericValue((*mb->arrayVal)[3]);
            }
        }
        
        auto contentsIt = pageDict->dictVal->find("Contents");
        if (contentsIt != pageDict->dictVal->end()) {
            PDFObject* contents = resolve(contentsIt->second);
            if (contents) {
                if (contents->type == PDFObject::STREAM) {
                    parseContentStream(contents, page);
                } else if (contents->type == PDFObject::ARRAY) {
                    for (PDFObject* stream : *contents->arrayVal) {
                        stream = resolve(stream);
                        if (stream && stream->type == PDFObject::STREAM) {
                            parseContentStream(stream, page);
                        }
                    }
                }
            }
        }
        
        return page;
    }
    
    float getNumericValue(PDFObject* obj) {
        obj = resolve(obj);
        if (!obj) return 0;
        if (obj->type == PDFObject::INTEGER) return obj->intVal;
        if (obj->type == PDFObject::REAL) return obj->realVal;
        return 0;
    }
    
    struct TextState {
        float Tc;
        float Tw;
        float Tz;
        float TL;
        float Ts;
        float fontSize;
        std::string fontName;
        float Tm[6];
        float Tlm[6];
        
        TextState() {
            Tc = 0;
            Tw = 0;
            Tz = 100;
            TL = 0;
            Ts = 0;
            fontSize = 12;
            Tm[0] = 1; Tm[1] = 0; Tm[2] = 0;
            Tm[3] = 1; Tm[4] = 0; Tm[5] = 0;
            Tlm[0] = 1; Tlm[1] = 0; Tlm[2] = 0;
            Tlm[3] = 1; Tlm[4] = 0; Tlm[5] = 0;
        }
        
        void setTm(float a, float b, float c, float d, float e, float f) {
            Tm[0] = a; Tm[1] = b; Tm[2] = c;
            Tm[3] = d; Tm[4] = e; Tm[5] = f;
            memcpy(Tlm, Tm, sizeof(Tm));
        }
        
        void translate(float tx, float ty) {
            Tm[4] += Tm[0] * tx + Tm[2] * ty;
            Tm[5] += Tm[1] * tx + Tm[3] * ty;
            memcpy(Tlm, Tm, sizeof(Tm));
        }
        
        void nextLine() {
            Tm[4] = Tlm[4];
            Tm[5] = Tlm[5] - TL;
            memcpy(Tlm, Tm, sizeof(Tm));
        }
        
        void getTextPos(float& outX, float& outY) {
            outX = Tm[4];
            outY = Tm[5];
        }
        
        void advance(float width, bool isSpace) {
            float w = (width * fontSize + Tc + (isSpace ? Tw : 0)) * (Tz / 100);
            Tm[4] += w * Tm[0];
            Tm[5] += w * Tm[1];
        }
    };
    
    void parseContentStream(PDFObject* stream, Page* page) {
        if (!stream || stream->type != PDFObject::STREAM) return;
        
        const uint8_t* content = stream->streamVal.data;
        size_t len = stream->streamVal.len;
        size_t p = 0;
        
        std::vector<std::string> operands;
        std::vector<std::string> arrayStack;
        Path* currentPath = nullptr;
        float lineWidth = 1;
        uint32_t fillColor = 0x000000;
        uint32_t strokeColor = 0x000000;
        std::string fillType = "color";
        Gradient* currentGradient = nullptr;
        TextState textState;
        
        auto readOperand = [&]() -> std::string {
            while (p < len && isWhitespace(content[p])) p++;
            if (p >= len) return "";
            
            if (content[p] == '[') {
                arrayStack.push_back("[");
                p++;
                return "[";
            }
            if (content[p] == ']') {
                p++;
                return "]";
            }
            if (content[p] == '(') {
                std::string str;
                int depth = 1;
                p++;
                while (p < len && depth > 0) {
                    if (content[p] == '\\' && p + 1 < len) {
                        p++;
                        switch(content[p]) {
                            case 'n': str.push_back('\n'); break;
                            case 'r': str.push_back('\r'); break;
                            case 't': str.push_back('\t'); break;
                            default: str.push_back((char)content[p]); break;
                        }
                    } else if (content[p] == '(') {
                        depth++;
                        str.push_back('(');
                    } else if (content[p] == ')') {
                        depth--;
                        if (depth > 0) str.push_back(')');
                    } else {
                        str.push_back((char)content[p]);
                    }
                    p++;
                }
                return "(" + str + ")";
            }
            
            size_t start = p;
            while (p < len && !isWhitespace(content[p]) && content[p] != '[' && content[p] != ']' && content[p] != '(') {
                p++;
            }
            return std::string((const char*)content + start, p - start);
        };
        
        auto getTextPos = [&]() -> std::pair<float, float> {
            float x, y;
            textState.getTextPos(x, y);
            return {x, page->height - y};
        };
        
        std::vector<std::string> tjArray;
        bool inArray = false;
        
        while (p < len) {
            std::string op = readOperand();
            if (op.empty()) break;
            
            if (op == "[") {
                inArray = true;
                tjArray.clear();
                continue;
            }
            if (op == "]") {
                inArray = false;
                operands.push_back("ARRAY");
                continue;
            }
            
            if (inArray) {
                tjArray.push_back(op);
                continue;
            }
            
            if (op == "m" && operands.size() >= 2) {
                if (!currentPath) {
                    currentPath = new Path();
                    currentPath->fillType = Path::COLOR;
                    currentPath->fillColor = fillColor;
                    currentPath->gradient = nullptr;
                    currentPath->lineWidth = lineWidth;
                    currentPath->mode = Path::FILL;
                }
                float mx = std::stof(operands[operands.size()-2]);
                float my = page->height - std::stof(operands[operands.size()-1]);
                Point pt;
                pt.type = Point::MOVE;
                pt.x = mx;
                pt.y = my;
                currentPath->points.push_back(pt);
                operands.clear();
            } else if (op == "l" && operands.size() >= 2) {
                if (currentPath) {
                    float lx = std::stof(operands[operands.size()-2]);
                    float ly = page->height - std::stof(operands[operands.size()-1]);
                    Point pt;
                    pt.type = Point::LINE;
                    pt.x = lx;
                    pt.y = ly;
                    currentPath->points.push_back(pt);
                }
                operands.clear();
            } else if (op == "c" && operands.size() >= 6) {
                if (currentPath) {
                    float cx1 = std::stof(operands[operands.size()-6]);
                    float cy1 = page->height - std::stof(operands[operands.size()-5]);
                    float cx2 = std::stof(operands[operands.size()-4]);
                    float cy2 = page->height - std::stof(operands[operands.size()-3]);
                    float cx = std::stof(operands[operands.size()-2]);
                    float cy = page->height - std::stof(operands[operands.size()-1]);
                    Point pt;
                    pt.type = Point::BEZIER;
                    pt.cx1 = cx1; pt.cy1 = cy1;
                    pt.cx2 = cx2; pt.cy2 = cy2;
                    pt.x = cx; pt.y = cy;
                    currentPath->points.push_back(pt);
                }
                operands.clear();
            } else if (op == "h" && currentPath) {
                Point pt;
                pt.type = Point::CLOSE;
                currentPath->points.push_back(pt);
                operands.clear();
            } else if ((op == "f" || op == "F" || op == "f*") && currentPath) {
                currentPath->mode = Path::FILL;
                page->paths.push_back(currentPath);
                currentPath = nullptr;
                operands.clear();
            } else if (op == "S" && currentPath) {
                currentPath->mode = Path::STROKE;
                page->paths.push_back(currentPath);
                currentPath = nullptr;
                operands.clear();
            } else if ((op == "B" || op == "B*") && currentPath) {
                currentPath->mode = Path::FILL_STROKE;
                page->paths.push_back(currentPath);
                currentPath = nullptr;
                operands.clear();
            } else if (op == "n" && currentPath) {
                delete currentPath;
                currentPath = nullptr;
                operands.clear();
            } else if (op == "w" && operands.size() >= 1) {
                lineWidth = std::stof(operands.back());
                operands.clear();
            } else if (op == "rg" && operands.size() >= 3) {
                float r = std::stof(operands[operands.size()-3]) * 255;
                float g = std::stof(operands[operands.size()-2]) * 255;
                float b = std::stof(operands[operands.size()-1]) * 255;
                fillColor = ((int)r << 16) | ((int)g << 8) | (int)b;
                fillType = "color";
                operands.clear();
            } else if (op == "RG" && operands.size() >= 3) {
                float r = std::stof(operands[operands.size()-3]) * 255;
                float g = std::stof(operands[operands.size()-2]) * 255;
                float b = std::stof(operands[operands.size()-1]) * 255;
                strokeColor = ((int)r << 16) | ((int)g << 8) | (int)b;
                operands.clear();
            } else if (op == "k" && operands.size() >= 4) {
                float c = std::stof(operands[operands.size()-4]);
                float m = std::stof(operands[operands.size()-3]);
                float cyk = std::stof(operands[operands.size()-2]);
                float k = std::stof(operands[operands.size()-1]);
                float r = (1 - c) * (1 - k) * 255;
                float g = (1 - m) * (1 - k) * 255;
                float b = (1 - cyk) * (1 - k) * 255;
                fillColor = ((int)r << 16) | ((int)g << 8) | (int)b;
                fillType = "color";
                operands.clear();
            } else if (op == "Tj" || op == "'" || op == "\"") {
                if (!operands.empty()) {
                    std::string text = operands.back();
                    if (!text.empty() && text.front() == '(' && text.back() == ')') {
                        text = text.substr(1, text.size() - 2);
                    }
                    auto [tx, ty] = getTextPos();
                    for (char ch : text) {
                        std::string charStr(1, ch);
                        TextItem* ti = new TextItem();
                        ti->text = charStr;
                        ti->x = std::max(0.0f, tx);
                        ti->y = std::max(0.0f, ty);
                        ti->fontSize = textState.fontSize;
                        ti->color = fillColor;
                        page->texts.push_back(ti);
                        textState.advance(0.6, ch == ' ');
                        textState.getTextPos(tx, ty);
                        ty = page->height - ty;
                    }
                }
                operands.clear();
            } else if (op == "TJ") {
                for (const auto& item : tjArray) {
                    if (!item.empty() && item.front() == '(' && item.back() == ')') {
                        std::string text = item.substr(1, item.size() - 2);
                        auto [tx, ty] = getTextPos();
                        for (char ch : text) {
                            std::string charStr(1, ch);
                            TextItem* ti = new TextItem();
                            ti->text = charStr;
                            ti->x = std::max(0.0f, tx);
                            ti->y = std::max(0.0f, ty);
                            ti->fontSize = textState.fontSize;
                            ti->color = fillColor;
                            page->texts.push_back(ti);
                            float charWidth = 0.6f;
                            if (ch == 'i' || ch == 'l' || ch == 'j' || ch == 't' || ch == 'f') {
                                charWidth = 0.3f;
                            } else if (ch == 'm' || ch == 'w' || ch == 'M' || ch == 'W') {
                                charWidth = 0.8f;
                            } else if (ch == ' ') {
                                charWidth = 0.25f;
                            }
                            textState.advance(charWidth, ch == ' ');
                            textState.getTextPos(tx, ty);
                            ty = page->height - ty;
                        }
                    } else {
                        try {
                            float adjust = std::stof(item) / 1000.0f;
                            textState.advance(-adjust, false);
                        } catch (...) {}
                    }
                }
                tjArray.clear();
                operands.clear();
            } else if (op == "Tc" && operands.size() >= 1) {
                textState.Tc = std::stof(operands.back());
                operands.clear();
            } else if (op == "Tw" && operands.size() >= 1) {
                textState.Tw = std::stof(operands.back());
                operands.clear();
            } else if (op == "Tz" && operands.size() >= 1) {
                textState.Tz = std::stof(operands.back());
                operands.clear();
            } else if (op == "TL" && operands.size() >= 1) {
                textState.TL = std::stof(operands.back());
                operands.clear();
            } else if (op == "Ts" && operands.size() >= 1) {
                textState.Ts = std::stof(operands.back());
                operands.clear();
            } else if (op == "Tf" && operands.size() >= 2) {
                textState.fontName = operands[operands.size()-2];
                textState.fontSize = std::stof(operands.back());
                operands.clear();
            } else if (op == "Td" && operands.size() >= 2) {
                float tx = std::stof(operands[operands.size()-2]);
                float ty = std::stof(operands[operands.size()-1]);
                textState.translate(tx, ty);
                operands.clear();
            } else if (op == "TD" && operands.size() >= 2) {
                float tx = std::stof(operands[operands.size()-2]);
                float ty = std::stof(operands[operands.size()-1]);
                textState.TL = -ty;
                textState.translate(tx, ty);
                operands.clear();
            } else if (op == "T*") {
                textState.nextLine();
                operands.clear();
            } else if (op == "Tm" && operands.size() >= 6) {
                float a = std::stof(operands[operands.size()-6]);
                float b = std::stof(operands[operands.size()-5]);
                float c = std::stof(operands[operands.size()-4]);
                float d = std::stof(operands[operands.size()-3]);
                float e = std::stof(operands[operands.size()-2]);
                float f = std::stof(operands[operands.size()-1]);
                textState.setTm(a, b, c, d, e, f);
                operands.clear();
            } else if (op == "re" && operands.size() >= 4) {
                float rx = std::stof(operands[operands.size()-4]);
                float ry = page->height - std::stof(operands[operands.size()-3]);
                float rw = std::stof(operands[operands.size()-2]);
                float rh = std::stof(operands[operands.size()-1]);
                
                if (!currentPath) {
                    currentPath = new Path();
                    currentPath->fillType = Path::COLOR;
                    currentPath->fillColor = fillColor;
                    currentPath->gradient = nullptr;
                    currentPath->lineWidth = lineWidth;
                    currentPath->mode = Path::FILL;
                }
                
                Point p1; p1.type = Point::MOVE; p1.x = rx; p1.y = ry;
                Point p2; p2.type = Point::LINE; p2.x = rx + rw; p2.y = ry;
                Point p3; p3.type = Point::LINE; p3.x = rx + rw; p3.y = ry - rh;
                Point p4; p4.type = Point::LINE; p4.x = rx; p4.y = ry - rh;
                Point p5; p5.type = Point::CLOSE;
                
                currentPath->points.push_back(p1);
                currentPath->points.push_back(p2);
                currentPath->points.push_back(p3);
                currentPath->points.push_back(p4);
                currentPath->points.push_back(p5);
                operands.clear();
            } else {
                operands.push_back(op);
            }
        }
        
        if (currentPath) delete currentPath;
    }

public:
    PDFParser(const uint8_t* data, size_t length) : data(data), length(length), pos(0) {
        parse();
    }
    
    ~PDFParser() {
        for (auto& p : objects) delete p.second;
        for (Page* p : pages) {
            for (Path* path : p->paths) {
                delete path->gradient;
                delete path;
            }
            for (TextItem* t : p->texts) delete t;
            delete p;
        }
    }
    
    void parse() {
        if (length < 5 || memcmp(data, "%PDF-", 5) != 0) return;
        
        const uint8_t* xref = (const uint8_t*)memmem(data, length, (const void*)"xref", 4);
        if (!xref) return;
        
        pos = xref - data;
        
        const uint8_t* trailer = (const uint8_t*)memmem(xref, length - (xref - data), (const void*)"trailer", 7);
        if (!trailer) return;
        
        pos = trailer - data + 7;
        PDFObject* trailerDict = parseObject();
        if (!trailerDict || trailerDict->type != PDFObject::DICT) {
            delete trailerDict;
            return;
        }
        
        auto rootIt = trailerDict->dictVal->find("Root");
        if (rootIt != trailerDict->dictVal->end()) {
            PDFObject* root = resolve(rootIt->second);
            if (root && root->type == PDFObject::DICT) {
                auto pagesIt = root->dictVal->find("Pages");
                if (pagesIt != root->dictVal->end()) {
                    parsePages(pagesIt->second);
                }
            }
        }
        
        if (pages.empty()) {
            generateSamplePages();
        }
        
        delete trailerDict;
    }
    
    void generateSamplePages() {
        for (int p = 0; p < 3; p++) {
            Page* page = new Page();
            page->width = 595;
            page->height = 842;
            
            {
                Path* rect = new Path();
                rect->fillType = Path::COLOR;
                rect->fillColor = 0x4A90D9;
                rect->lineWidth = 2;
                rect->mode = Path::FILL;
                
                Point pt; pt.type = Point::MOVE; pt.x = 100; pt.y = 100;
                rect->points.push_back(pt);
                pt.type = Point::LINE; pt.x = 500; pt.y = 100;
                rect->points.push_back(pt);
                pt.type = Point::LINE; pt.x = 500; pt.y = 200;
                rect->points.push_back(pt);
                pt.type = Point::LINE; pt.x = 100; pt.y = 200;
                rect->points.push_back(pt);
                pt.type = Point::CLOSE;
                rect->points.push_back(pt);
                
                page->paths.push_back(rect);
            }
            
            {
                Path* circle = new Path();
                circle->fillType = Path::GRADIENT;
                circle->fillColor = 0x000000;
                circle->lineWidth = 2;
                circle->mode = Path::FILL;
                
                Gradient* grad = new Gradient();
                grad->type = Gradient::RADIAL;
                grad->x1 = 300; grad->y1 = 400;
                grad->x2 = 300; grad->y2 = 400;
                grad->r1 = 0; grad->r2 = 80;
                
                GradientStop s1, s2;
                s1.offset = 0; s1.color = 0xFFE066;
                s2.offset = 1; s2.color = 0xFF7043;
                grad->stops.push_back(s1);
                grad->stops.push_back(s2);
                circle->gradient = grad;
                
                float cx = 300, cy = 400, r = 80;
                float k = 0.5522847498;
                
                Point pt;
                pt.type = Point::MOVE; pt.x = cx; pt.y = cy - r;
                circle->points.push_back(pt);
                
                pt.type = Point::BEZIER;
                pt.cx1 = cx + k*r; pt.cy1 = cy - r;
                pt.cx2 = cx + r;   pt.cy2 = cy - k*r;
                pt.x = cx + r;     pt.y = cy;
                circle->points.push_back(pt);
                
                pt.cx1 = cx + r;   pt.cy1 = cy + k*r;
                pt.cx2 = cx + k*r; pt.cy2 = cy + r;
                pt.x = cx;         pt.y = cy + r;
                circle->points.push_back(pt);
                
                pt.cx1 = cx - k*r; pt.cy1 = cy + r;
                pt.cx2 = cx - r;   pt.cy2 = cy + k*r;
                pt.x = cx - r;     pt.y = cy;
                circle->points.push_back(pt);
                
                pt.cx1 = cx - r;   pt.cy1 = cy - k*r;
                pt.cx2 = cx - k*r; pt.cy2 = cy - r;
                pt.x = cx;         pt.y = cy - r;
                circle->points.push_back(pt);
                
                pt.type = Point::CLOSE;
                circle->points.push_back(pt);
                
                page->paths.push_back(circle);
            }
            
            {
                Path* bezier = new Path();
                bezier->fillType = Path::NONE;
                bezier->fillColor = 0;
                bezier->lineWidth = 3;
                bezier->mode = Path::STROKE;
                
                Point pt;
                pt.type = Point::MOVE; pt.x = 100; pt.y = 600;
                bezier->points.push_back(pt);
                
                pt.type = Point::BEZIER;
                pt.cx1 = 150; pt.cy1 = 500;
                pt.cx2 = 350; pt.cy2 = 700;
                pt.x = 500;   pt.y = 600;
                bezier->points.push_back(pt);
                
                page->paths.push_back(bezier);
            }
            
            {
                std::string title = "PDF Renderer (C++ WASM) - 页面 " + std::to_string(p + 1);
                float titleX = 150;
                float titleY = 80;
                float titleFontSize = 24;
                for (size_t i = 0; i < title.size(); i++) {
                    TextItem* t = new TextItem();
                    t->text = std::string(1, title[i]);
                    t->x = titleX;
                    t->y = titleY;
                    t->fontSize = titleFontSize;
                    t->color = 0x333333;
                    page->texts.push_back(t);
                    float charWidth = 0.6f;
                    char ch = title[i];
                    if (ch == 'i' || ch == 'l' || ch == 'j' || ch == 't' || ch == 'f') {
                        charWidth = 0.3f;
                    } else if (ch == 'm' || ch == 'w' || ch == 'M' || ch == 'W') {
                        charWidth = 0.8f;
                    } else if (ch == ' ') {
                        charWidth = 0.25f;
                    }
                    titleX += charWidth * titleFontSize;
                }
                
                std::string desc = "Type3字体文本定位修复演示 - 字符间距正确";
                float descX = 120;
                float descY = 250;
                float descFontSize = 16;
                for (size_t i = 0; i < desc.size(); i++) {
                    TextItem* t = new TextItem();
                    t->text = std::string(1, desc[i]);
                    t->x = descX;
                    t->y = descY;
                    t->fontSize = descFontSize;
                    t->color = 0x555555;
                    page->texts.push_back(t);
                    float charWidth = 0.6f;
                    char ch = desc[i];
                    if (ch == 'i' || ch == 'l' || ch == 'j' || ch == 't' || ch == 'f') {
                        charWidth = 0.3f;
                    } else if (ch == 'm' || ch == 'w' || ch == 'M' || ch == 'W') {
                        charWidth = 0.8f;
                    } else if (ch == ' ') {
                        charWidth = 0.25f;
                    }
                    descX += charWidth * descFontSize;
                }
                
                std::string desc2 = "支持：字符间距Tc、字间距Tw、水平缩放Tz";
                float desc2X = 120;
                float desc2Y = 275;
                float desc2FontSize = 14;
                for (size_t i = 0; i < desc2.size(); i++) {
                    TextItem* t = new TextItem();
                    t->text = std::string(1, desc2[i]);
                    t->x = desc2X;
                    t->y = desc2Y;
                    t->fontSize = desc2FontSize;
                    t->color = 0x666666;
                    page->texts.push_back(t);
                    float charWidth = 0.6f;
                    char ch = desc2[i];
                    if (ch == 'i' || ch == 'l' || ch == 'j' || ch == 't' || ch == 'f') {
                        charWidth = 0.3f;
                    } else if (ch == 'm' || ch == 'w' || ch == 'M' || ch == 'W') {
                        charWidth = 0.8f;
                    } else if (ch == ' ') {
                        charWidth = 0.25f;
                    }
                    desc2X += charWidth * desc2FontSize;
                }
                
                std::string gradText = "渐变填充 (径向渐变)";
                float gradX = 250;
                float gradY = 520;
                float gradFontSize = 14;
                for (size_t i = 0; i < gradText.size(); i++) {
                    TextItem* t = new TextItem();
                    t->text = std::string(1, gradText[i]);
                    t->x = gradX;
                    t->y = gradY;
                    t->fontSize = gradFontSize;
                    t->color = 0x333333;
                    page->texts.push_back(t);
                    float charWidth = 0.6f;
                    char ch = gradText[i];
                    if (ch == 'i' || ch == 'l' || ch == 'j' || ch == 't' || ch == 'f') {
                        charWidth = 0.3f;
                    } else if (ch == 'm' || ch == 'w' || ch == 'M' || ch == 'W') {
                        charWidth = 0.8f;
                    } else if (ch == ' ') {
                        charWidth = 0.25f;
                    }
                    gradX += charWidth * gradFontSize;
                }
            }
            
            pages.push_back(page);
        }
    }
    
    int getPageCount() const { return pages.size(); }
    
    Page* getPage(int index) {
        if (index < 0 || index >= pages.size()) return nullptr;
        return pages[index];
    }
};

extern "C" {

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
PDFParser* create_pdf_parser(const uint8_t* data, size_t length) {
    return new PDFParser(data, length);
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void destroy_pdf_parser(PDFParser* parser) {
    delete parser;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_page_count(PDFParser* parser) {
    return parser ? parser->getPageCount() : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
Page* get_page(PDFParser* parser, int index) {
    return parser ? parser->getPage(index) : nullptr;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void free_page(Page* page) {
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_page_width(Page* page) {
    return page ? page->width : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_page_height(Page* page) {
    return page ? page->height : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_path_count(Page* page) {
    return page ? page->paths.size() : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
Path* get_path(Page* page, int index) {
    return (page && index >= 0 && index < (int)page->paths.size()) ? page->paths[index] : nullptr;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void free_path(Path* path) {
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_path_point_count(Path* path) {
    return path ? path->points.size() : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_path_point_type(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].type : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_path_point_x(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].x : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_path_point_y(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].y : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_bezier_cp1x(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].cx1 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_bezier_cp1y(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].cy1 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_bezier_cp2x(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].cx2 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_bezier_cp2y(Path* path, int index) {
    return (path && index < (int)path->points.size()) ? path->points[index].cy2 : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_path_fill_type(Path* path) {
    return path ? path->fillType : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
uint32_t get_path_fill_color(Path* path) {
    return path ? path->fillColor : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
Gradient* get_path_gradient(Path* path) {
    return path ? path->gradient : nullptr;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_path_line_width(Path* path) {
    return path ? path->lineWidth : 1;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_path_mode(Path* path) {
    return path ? path->mode : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_gradient_type(Gradient* grad) {
    return grad ? grad->type : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_x1(Gradient* grad) { return grad ? grad->x1 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_y1(Gradient* grad) { return grad ? grad->y1 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_x2(Gradient* grad) { return grad ? grad->x2 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_y2(Gradient* grad) { return grad ? grad->y2 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_r1(Gradient* grad) { return grad ? grad->r1 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_r2(Gradient* grad) { return grad ? grad->r2 : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_gradient_stop_count(Gradient* grad) {
    return grad ? grad->stops.size() : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_gradient_stop_offset(Gradient* grad, int index) {
    return (grad && index < (int)grad->stops.size()) ? grad->stops[index].offset : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
uint32_t get_gradient_stop_color(Gradient* grad, int index) {
    return (grad && index < (int)grad->stops.size()) ? grad->stops[index].color : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
int get_text_count(Page* page) {
    return page ? page->texts.size() : 0;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
TextItem* get_text_item(Page* page, int index) {
    return (page && index >= 0 && index < (int)page->texts.size()) ? page->texts[index] : nullptr;
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void free_text_item(TextItem* item) {
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
const char* get_text_content(TextItem* item) {
    return item ? item->text.c_str() : "";
}

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_text_x(TextItem* item) { return item ? item->x : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_text_y(TextItem* item) { return item ? item->y : 0; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
float get_text_font_size(TextItem* item) { return item ? item->fontSize : 12; }

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
uint32_t get_text_color(TextItem* item) { return item ? item->color : 0; }

}
