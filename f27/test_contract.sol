pragma solidity ^0.7.0;

contract VulnerableBank {
    mapping(address => uint256) public balances;

    function deposit() public payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 _amount) public {
        require(balances[msg.sender] >= _amount);
        
        (bool success, ) = msg.sender.call{value: _amount}("");
        
        balances[msg.sender] -= _amount;
    }

    function transfer(address _to, uint256 _amount) public {
        require(balances[msg.sender] >= _amount);
        balances[msg.sender] -= _amount;
        balances[_to] += _amount;
    }

    function unsafeSend(address payable _to, uint256 _amount) public {
        _to.send(_amount);
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }

    function complexFunction(uint256 x) public pure returns (uint256) {
        uint256 result = 0;
        if (x > 10) {
            result += 1;
        } else if (x > 5) {
            result += 2;
        } else {
            result += 3;
        }
        
        for (uint256 i = 0; i < x; i++) {
            result += i;
        }
        
        while (result < 100) {
            result *= 2;
        }
        
        return result;
    }
}
